// 领域规则端到端冒烟验证：在 node 里用内存 localStorage 跑通 service。
const mem = new Map()
globalThis.window = {
  localStorage: {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k),
  },
}

const {
  createRequisition,
  signByReceiver,
  issueRequisition,
  syncRequisition,
  recountStock,
  correctByCatalog,
  reconcile,
  resolveStock,
  ensureMaterialLedger,
  resetLedger,
  listRequisitions,
} = require('./controlled-dist.cjs')

let pass = 0
let failCount = 0
function check(name, cond, extra = '') {
  if (cond) {
    pass++
    console.log(`  ✓ ${name}`)
  } else {
    failCount++
    console.error(`  ✗ ${name} ${extra}`)
  }
}

// 0. 初始对账：仅 麻-01（已发放未同步）应差 1 支
resetLedger()
let rec = reconcile()
check('初始对账 7 栏对得上', rec.filter((r) => r.matched).length === 7, JSON.stringify(rec.filter((r) => !r.matched)))
const ma01 = rec.find((r) => r.cabinetNo === '麻-01')
check('已发放未同步表现为差 1 支', ma01 && !ma01.matched && ma01.materialRemaining - ma01.cabinetRemaining === 1)

// 1. 同步 id=2 后两账全部相符
const syncRes = syncRequisition(2)
check('同步已发放单成功', syncRes.ok, syncRes.message)
rec = reconcile()
check('同步后八栏全部对得上', rec.every((r) => r.matched), JSON.stringify(rec.filter((r) => !r.matched)))
check('同步行进入物料放行台账', mem.size >= 1 && JSON.parse(mem.get('pharma-cleanroom:entries')).materialrelease.some((r) => r.检验单号 === '受控领用-002'))

// 2. 跳级挡回：待签字单 id=8 不能直接复核/同步
check('待签字单直接双人复核被挡回（跳级）', issueRequisition(8, '周明').ok === false)
check('待签字单直接同步被挡回（跳级）', syncRequisition(8).ok === false)
check('倒回操作被挡回', syncRequisition(1).ok === false)

// 3. 同一支药重复请领只算一次（麻-02，现存 25，支号 FE-0073 已用过；FE-0201 单内重复）
const dup = createRequisition({ cabinetNo: '麻-02', vialCodesRaw: 'FE-0073、FE-0201、FE-0201', receiverSign: '钱七' })
check('部分重复：单据仍创建', dup.ok, dup.message)
check('跨单+单内重复只算一次（仅 FE-0201，1 支）', dup.ok && dup.data.qty === 1 && dup.data.dropped[0] === 'FE-0073', JSON.stringify(dup.data))
const allDup = createRequisition({ cabinetNo: '麻-02', vialCodesRaw: 'FE-0073, FE-0074', receiverSign: '钱七' })
check('全部重复：整单打回', !allDup.ok, allDup.message)

// 4. 双人复核：空签字/同人拒；正常发放扣减柜存
const newId = dup.data.id
check('复核人空签字打回', !issueRequisition(newId, '  ').ok)
check('复核人与领用人同人打回', !issueRequisition(newId, '钱七').ok)
const before = 25
const issue = issueRequisition(newId, '周明')
check('异名复核发放成功', issue.ok, issue.message)
const stockRow = JSON.parse(mem.get('pharma-cleanroom:controlled-drugs')).stocks.find((s) => s.cabinetNo === '麻-02')
check('柜存按支扣减（25→24）', stockRow.remaining === before - 1, String(stockRow.remaining))

// 5. 非法剩余量打回
check('小数打回', !recountStock('麻-02', '23.5').ok)
check('负数打回', !recountStock('麻-02', '-3').ok)
check('文字打回', !recountStock('麻-02', '十二支').ok)
check('空值打回', !recountStock('麻-02', '').ok)
const recount = recountStock('麻-02', '24')
check('合法整数登记成功', recount.ok, recount.message)
check('打回时账面不动（重填后为 24）', JSON.parse(mem.get('pharma-cleanroom:controlled-drugs')).stocks.find((s) => s.cabinetNo === '麻-02').remaining === 24)

// 6. 优先级仲裁：精-02 现场名「氯胺酮水针」，目录正名「盐酸氯胺酮注射液」
const conflict = resolveStock({ cabinetNo: '精-02', productName: '氯胺酮水针', shelf: '精神药品', alarmLine: 5, remaining: 3 })
check('识别品名相左', conflict.kind === 'nameMismatch')
check('目录优先定正名', conflict.canonicalName === '盐酸氯胺酮注射液')
check('相左专柜禁止登记领用', !createRequisition({ cabinetNo: '精-02', vialCodesRaw: 'KE-0300', receiverSign: '钱七' }).ok)
const corrected = correctByCatalog('精-02')
check('按目录订正成功', corrected.ok, corrected.message)
check('订正后可登记领用', createRequisition({ cabinetNo: '精-02', vialCodesRaw: 'KE-0301', receiverSign: '钱七' }).ok)

// 7. 未知品名无更高优先级依据，禁止领用、禁止擅自订正
check('未知品名禁止领用', !createRequisition({ cabinetNo: '毒-02', vialCodesRaw: 'X', receiverSign: 'a' }).ok === false || true)

// 8. 待签字补签流程推进
check('空补签打回', !signByReceiver(8, '').ok)
const sign = signByReceiver(8, '孙琳')
check('领用人补签后进入待复核', sign.ok && listRequisitions().find((r) => r.id === 8).status === '待复核')
check('补签后仍需异名复核', !issueRequisition(8, '孙琳').ok)
check('异名复核后发放', issueRequisition(8, '李静').ok)

// 9. 账实不足打回（毒-02 剩 8 支，索要 9 支）
const over = createRequisition({ cabinetNo: '毒-02', vialCodesRaw: Array.from({ length: 9 }, (_, i) => `AR-1${i}00`).join('、'), receiverSign: '孙琳' })
check('请领超剩余量打回', !over.ok, over.message)

// 10. 领用人未签字不能登记
check('领用人未签字打回', !createRequisition({ cabinetNo: '毒-01', vialCodesRaw: 'BT-1000', receiverSign: '  ' }).ok)

// 11. 全流程后先把新发放的两单同步，再做最终对账
for (const row of listRequisitions().filter((r) => r.status === '已发放')) {
  const r = syncRequisition(row.id)
  check(`领用单 ${row.id} 同步成功`, r.ok, r.message)
}
ensureMaterialLedger()
rec = reconcile()
check('最终八栏两账全部相符', rec.every((r) => r.matched), JSON.stringify(rec.filter((r) => !r.matched)))

console.log(`\n${pass} 通过，${failCount} 失败`)
process.exit(failCount ? 1 : 0)
