import { listRows, saveRows } from '@/data/local-store'
import { runAction } from '@/api/local-service'
import type { ActionResult, EntryRow } from '@/data/types'

// 特殊管理药品专柜台账的专用规则：登记、裁决、同步、对账都收在这里，页面不直接拼业务逻辑。
export const MODULE_KEY = 'controlleddrug'
const RELEASE_KEY = 'materialrelease'

// 专柜主数据：专柜按药品类别分架，物理布局固定，台账分栏以此为骨架。
export type Cabinet = { id: string; category: string; shelf: string }
export const CABINETS: Cabinet[] = [
  { id: '毒-01柜', category: '毒性药品', shelf: 'A架1层' },
  { id: '麻-01柜', category: '麻醉药品', shelf: 'B架1层' },
  { id: '麻-02柜', category: '麻醉药品', shelf: 'B架2层' },
  { id: '精-01柜', category: '精神药品', shelf: 'C架1层' },
  { id: '放-01柜', category: '放射性药品', shelf: 'D架1层' },
]

// 品名法定目录：品名 → 法定管理类别。裁决专柜与品名相左时以这份为准。
export const DRUG_CATALOG: Record<string, { category: string; spec: string }> = {
  阿托品注射液: { category: '毒性药品', spec: '1ml:0.5mg' },
  吗啡注射液: { category: '麻醉药品', spec: '1ml:10mg' },
  芬太尼透皮贴剂: { category: '麻醉药品', spec: '4.2mg/贴' },
  地西泮注射液: { category: '精神药品', spec: '2ml:10mg' },
  '碘[131I]化钠口服溶液': { category: '放射性药品', spec: '185MBq/支' },
}

export type DispenseInput = {
  专柜编号: string
  品名: string
  请领单号: string
  领用数量: string
  剩余量: string
  领用人签字: string
  复核人签字: string
  领用日期: string
}

export type RegisterResult = ActionResult & { notice?: string }

export type ReconcileRow = {
  专柜编号: string
  品名: string
  台账剩余量: number | null
  放行数量: number | null
  一致: boolean
  说明: string
}

function nextId(rows: EntryRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

function cabinetOf(id: string): Cabinet | undefined {
  return CABINETS.find((cabinet) => cabinet.id === id)
}

/** 柜内最新一笔登记：栏的当前剩余量、报警线都以它为准。 */
export function latestEntry(cabinetId: string, rows: EntryRow[] = listRows(MODULE_KEY)): EntryRow | null {
  const entries = rows
    .filter((row) => String(row['专柜编号']) === cabinetId)
    .sort((a, b) => Number(b.id) - Number(a.id))
  return entries[0] ?? null
}

/** 剩余量按支点数：只认非负整数，其余一律算非法值。 */
function parseCount(raw: string): number | null {
  const text = raw.trim()
  if (!/^\d+$/.test(text)) {
    return null
  }
  return Number(text)
}

/**
 * 专柜与品名相左时先判优先级，再定按哪一份：
 * 品名的法定管理类别出自目录，优先级高于专柜的登记类别，冲突一律按品名法定类别入账。
 */
export function resolveCategory(cabinetId: string, drugName: string): {
  category: string
  conflict: boolean
  notice: string
} {
  const cabinet = cabinetOf(cabinetId)
  const catalog = DRUG_CATALOG[drugName]
  const cabinetCategory = cabinet?.category ?? ''
  if (!catalog || !cabinetCategory || catalog.category === cabinetCategory) {
    return { category: catalog?.category ?? cabinetCategory, conflict: false, notice: '' }
  }
  return {
    category: catalog.category,
    conflict: true,
    notice: `专柜「${cabinetId}」登记为${cabinetCategory}，品名「${drugName}」法定为${catalog.category}；法定目录优先级高于专柜登记，本笔按品名法定类别入账`,
  }
}

/** 登记一笔领用：非法剩余量打回重填，同一请领单号重复请领只算一次。 */
export function registerDispense(input: DispenseInput): RegisterResult {
  const cabinet = cabinetOf(input.专柜编号)
  if (!cabinet) {
    return { ok: false, message: `没有登记名为 ${input.专柜编号} 的专柜` }
  }
  if (!DRUG_CATALOG[input.品名]) {
    return { ok: false, message: `品名「${input.品名}」不在特殊管理药品目录里` }
  }
  for (const field of ['请领单号', '领用人签字', '复核人签字', '领用日期'] as const) {
    if (!input[field].trim()) {
      return { ok: false, message: `${field}不能为空` }
    }
  }
  const dispenseCount = parseCount(input.领用数量)
  if (dispenseCount === null || dispenseCount <= 0) {
    return { ok: false, message: `领用数量「${input.领用数量}」不是正整数支数，打回重填` }
  }
  const remaining = parseCount(input.剩余量)
  if (remaining === null) {
    return { ok: false, message: `剩余量「${input.剩余量}」是非法值，剩余量按支点数只能填非负整数，打回重填` }
  }
  const rows = listRows(MODULE_KEY)
  const duplicated = rows.some((row) => String(row['请领单号']) === input.请领单号.trim())
  if (duplicated) {
    return { ok: false, message: `请领单号 ${input.请领单号.trim()} 已登记入账，同一支药重复请领只算一次` }
  }
  const verdict = resolveCategory(input.专柜编号, input.品名)
  const previous = latestEntry(input.专柜编号, rows)
  const entry: EntryRow = {
    id: nextId(rows),
    status: '待复核',
    pending: true,
    abnormal: verdict.conflict,
    专柜编号: input.专柜编号,
    药品类别: verdict.category,
    分架: cabinet.shelf,
    品名: input.品名,
    规格: DRUG_CATALOG[input.品名].spec,
    请领单号: input.请领单号.trim(),
    领用数量: dispenseCount,
    剩余量: remaining,
    报警线: previous ? Number(previous['报警线']) : 10,
    领用人签字: input.领用人签字.trim(),
    复核人签字: input.复核人签字.trim(),
    领用日期: input.领用日期.trim(),
    台账状态: '在账',
  }
  saveRows(MODULE_KEY, [...rows, entry])
  return {
    ok: true,
    message: `已登记 ${input.品名} 领用 ${dispenseCount} 支，柜内剩余 ${remaining} 支，待复核`,
    notice: verdict.notice || undefined,
  }
}

/** 把一柜的台账结果同步到物料放行台账：按专柜编号 upsert，重复同步只更新不重复建行。 */
export function syncCabinetToMaterialRelease(cabinetId: string): ActionResult {
  const latest = latestEntry(cabinetId)
  if (!latest) {
    return { ok: false, message: `专柜「${cabinetId}」还没有领用登记，没有可同步的台账结果` }
  }
  const releaseRows = listRows(RELEASE_KEY)
  const index = releaseRows.findIndex((row) => String(row['物料批号']) === cabinetId)
  const payload: EntryRow = {
    id: index >= 0 ? Number(releaseRows[index].id) : nextId(releaseRows),
    status: '已放行',
    pending: false,
    abnormal: false,
    物料批号: cabinetId,
    物料名称: String(latest['品名']),
    供应商: '特殊管理药品专柜',
    检验单号: String(latest['请领单号']),
    放行数量: Number(latest['剩余量']),
    放行人: String(latest['复核人签字']),
    放行日期: String(latest['领用日期']),
    放行状态: '已放行',
  }
  const next = [...releaseRows]
  if (index >= 0) {
    next[index] = payload
  } else {
    next.push(payload)
  }
  saveRows(RELEASE_KEY, next)
  return { ok: true, message: `专柜「${cabinetId}」台账结果已同步到物料放行，剩余量 ${payload['放行数量']} 支` }
}

/** 状态一步步往前推进；走到「已归档」这一步时把结果同步到物料放行台账。 */
export function advanceLedger(id: number, action: string): ActionResult {
  const result = runAction(MODULE_KEY, id, action)
  if (result.ok && action === '归档同步') {
    const row = listRows(MODULE_KEY).find((item) => Number(item.id) === id)
    if (row) {
      syncCabinetToMaterialRelease(String(row['专柜编号']))
    }
  }
  return result
}

/** 对账：专柜台账的柜内剩余量与物料放行台账的同步数量逐柜核对，两边对得上才算平。 */
export function reconcileRemaining(): ReconcileRow[] {
  const releaseRows = listRows(RELEASE_KEY)
  return CABINETS.map((cabinet) => {
    const latest = latestEntry(cabinet.id)
    const released = releaseRows.find((row) => String(row['物料批号']) === cabinet.id)
    const ledgerRemaining = latest ? Number(latest['剩余量']) : null
    const releaseQuantity = released ? Number(released['放行数量']) : null
    const match = ledgerRemaining !== null && ledgerRemaining === releaseQuantity
    let 说明 = '两处对得上'
    if (ledgerRemaining === null) {
      说明 = '专柜暂无领用登记'
    } else if (releaseQuantity === null) {
      说明 = '物料放行台账未同步'
    } else if (!match) {
      说明 = '两处数量对不上，需复盘'
    }
    return {
      专柜编号: cabinet.id,
      品名: latest ? String(latest['品名']) : '—',
      台账剩余量: ledgerRemaining,
      放行数量: releaseQuantity,
      一致: match,
      说明,
    }
  })
}
