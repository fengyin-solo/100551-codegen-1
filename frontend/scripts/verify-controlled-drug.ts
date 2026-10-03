// 临时验证脚本：把专柜台账的业务规则逐条跑一遍（node 环境走 local-store 的内存兜底）。
import {
  advanceLedger,
  reconcileRemaining,
  registerDispense,
  resolveCategory,
} from '@/api/controlled-drug'
import { runAction } from '@/api/local-service'
import { listRows } from '@/data/local-store'

let passed = 0
let failed = 0
function check(name: string, cond: boolean, detail = '') {
  if (cond) {
    passed += 1
    console.log(`  ✓ ${name}`)
  } else {
    failed += 1
    console.log(`  ✗ ${name} ${detail}`)
  }
}

const base = {
  专柜编号: '麻-01柜',
  品名: '吗啡注射液',
  请领单号: 'CTRL-1001',
  领用数量: '2',
  剩余量: '4',
  领用人签字: '测试员',
  复核人签字: '复核员',
  领用日期: '2026-10-03',
}

console.log('1. 正常登记')
const r1 = registerDispense(base)
check('登记成功', r1.ok, r1.message)
check('新记录状态为待复核', listRows('controlleddrug').at(-1)?.status === '待复核')

console.log('2. 剩余量非法值打回重填')
for (const bad of ['-1', '1.5', 'abc', '', '  ']) {
    const r = registerDispense({ ...base, 请领单号: `CTRL-2${bad.length}${bad.charCodeAt(0) || 48}`, 剩余量: bad })
  check(`剩余量「${bad}」被打回`, !r.ok && r.message.includes('打回重填'), r.message)
}
const badCount = registerDispense({ ...base, 请领单号: 'CTRL-2999', 领用数量: '0' })
check('领用数量 0 被打回', !badCount.ok, badCount.message)

console.log('3. 同一支药重复请领只算一次')
const before = listRows('controlleddrug').length
const r3 = registerDispense(base)
check('重复请领被挡', !r3.ok && r3.message.includes('只算一次'), r3.message)
check('行数没有增加', listRows('controlleddrug').length === before)

console.log('4. 专柜与品名相左时按优先级裁决')
const verdict = resolveCategory('毒-01柜', '吗啡注射液')
check('判出冲突', verdict.conflict)
check('按品名法定类别（麻醉药品）入账', verdict.category === '麻醉药品')
const r4 = registerDispense({ ...base, 专柜编号: '毒-01柜', 请领单号: 'CTRL-1002', 剩余量: '9' })
const conflictRow = listRows('controlleddrug').find((row) => row['请领单号'] === 'CTRL-1002')
check('冲突登记入账并标异常', r4.ok && conflictRow?.abnormal === true, r4.message)
check('入账类别为麻醉药品', conflictRow?.['药品类别'] === '麻醉药品')
check('裁决说明非空', Boolean(r4.notice))

console.log('5. 状态一步步推进，跳级挡回')
const newId = Number(listRows('controlleddrug').at(-1)?.id)
const skip = advanceLedger(newId, '归档同步')
check('待复核直接归档被挡回', !skip.ok && skip.message.includes('跳级'), skip.message)
const step1 = advanceLedger(newId, '复核签字')
check('复核签字通过', step1.ok, step1.message)
const step2 = advanceLedger(newId, '归档同步')
check('归档同步通过', step2.ok, step2.message)
const again = advanceLedger(newId, '复核签字')
check('已归档再复核被挡', !again.ok, again.message)

console.log('6. 归档结果同步到物料放行台账')
const releaseRow = listRows('materialrelease').find((row) => row['物料批号'] === '毒-01柜')
check('物料放行出现该柜记录', Boolean(releaseRow))
check('同步数量为柜内剩余量 9 支', releaseRow?.['放行数量'] === 9)
const ledgerRow = listRows('controlleddrug').find((row) => row['请领单号'] === 'CTRL-1002')
check('专柜台账剩余量同为 9 支', ledgerRow?.['剩余量'] === 9)

console.log('7. 对账：两处查到的对得上')
const recon = reconcileRemaining()
const synced = recon.find((row) => row.专柜编号 === '毒-01柜')
check('毒-01柜对得上', synced?.一致 === true, synced?.说明)
const unsynced = recon.find((row) => row.专柜编号 === '麻-01柜')
check('未归档的柜标为未同步', unsynced?.一致 === false && unsynced.说明.includes('未同步'), unsynced?.说明)

console.log('8. 通用模块不受逐级校验影响')
const batch = listRows('batchrecord')[0]
const direct = runAction('batchrecord', Number(batch.id), '归档批记录')
check('批生产记录仍可直达归档', direct.ok, direct.message)

console.log(`\n结果：${passed} 通过，${failed} 失败`)
process.exit(failed ? 1 : 0)
