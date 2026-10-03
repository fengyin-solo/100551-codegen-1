import { listRows, saveRows } from '@/data/local-store'
import type { EntryRow } from '@/data/types'

import { controlledState, resetControlledState, saveControlledState } from './store'
import type {
  CabinetStock,
  DrugCatalogItem,
  DrugCategory,
  ReconcileItem,
  Requisition,
  RequisitionStatus,
  RuleResult,
} from './types'
import { DRUG_CATEGORIES, REQUISITION_STATUSES } from './types'

// 优先级：品名目录 > 专柜现场登记 > 领用单。专柜与品名相左时，目录说了算。
export type ConflictKind = 'none' | 'nameMismatch' | 'shelfMismatch' | 'unknown'

export type ResolvedStock = {
  stock: CabinetStock
  catalog: DrugCatalogItem | null
  kind: ConflictKind
  canonicalName: string
  canonicalShelf: DrugCategory
  decision: string
}

const MATERIAL_KEY = 'materialrelease'
const OPENING_PREFIX = '受控期初-'
const ISSUE_PREFIX = '受控领用-'

function ok(message: string): RuleResult {
  return { ok: true, message }
}

function fail<T = undefined>(message: string): RuleResult<T> {
  return { ok: false, message }
}

function nowText(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 按优先级仲裁专柜现场登记与品名目录：先判优先级，再定按哪一份。 */
export function resolveStock(stock: CabinetStock): ResolvedStock {
  const state = controlledState()
  const exact = state.catalog.find((item) => item.name === stock.productName)
  if (exact) {
    if (exact.category !== stock.shelf) {
      return {
        stock,
        catalog: exact,
        kind: 'shelfMismatch',
        canonicalName: exact.name,
        canonicalShelf: exact.category,
        decision: `现场货架为「${stock.shelf}」，目录载明属「${exact.category}」。目录优先，应改按「${exact.category}」架归位。`,
      }
    }
    return {
      stock,
      catalog: exact,
      kind: 'none',
      canonicalName: exact.name,
      canonicalShelf: exact.category,
      decision: '专柜登记与品名目录一致。',
    }
  }
  const byAlias = state.catalog.find((item) => (item.aliases ?? []).includes(stock.productName))
  if (byAlias) {
    return {
      stock,
      catalog: byAlias,
      kind: 'nameMismatch',
      canonicalName: byAlias.name,
      canonicalShelf: byAlias.category,
      decision: `专柜现场品名「${stock.productName}」与目录不符，目录正名「${byAlias.name}」。目录优先，应按目录订正。`,
    }
  }
  return {
    stock,
    catalog: null,
    kind: 'unknown',
    canonicalName: stock.productName,
    canonicalShelf: stock.shelf,
    decision: `品名「${stock.productName}」未收入品名目录，无更高优先级依据，禁止请领，先补目录再办。`,
  }
}

export function resolvedStocks(): ResolvedStock[] {
  return controlledState().stocks.map(resolveStock)
}

export function lowWaterStocks(): ResolvedStock[] {
  return resolvedStocks().filter((item) => item.stock.remaining < item.stock.alarmLine)
}

export function findStock(cabinetNo: string): CabinetStock | undefined {
  return controlledState().stocks.find((item) => item.cabinetNo === cabinetNo)
}

/** 最近一次已发放/已同步的领用登记：回答「上一支被谁领走、谁复核的」。 */
export function lastIssued(cabinetNo: string): Requisition | undefined {
  const done = controlledState().requisitions.filter(
    (row) => row.cabinetNo === cabinetNo && (row.status === '已发放' || row.status === '已同步'),
  )
  return done.sort((a, b) => b.issueDate.localeCompare(a.issueDate))[0]
}

function usedVialCodes(cabinetNo: string, excludeId?: number): Set<string> {
  const codes = new Set<string>()
  for (const row of controlledState().requisitions) {
    if (row.cabinetNo !== cabinetNo || row.id === excludeId) continue
    row.vialCodes.forEach((code) => codes.add(code))
  }
  return codes
}

/** 支号解析：顿号、逗号、空格、换行都认，同一批内重复只保留一支。 */
export function parseVialCodes(raw: string): string[] {
  return [...new Set(raw.split(/[\s,，、;；]+/).map((code) => code.trim()).filter(Boolean))]
}

function assertNextStep(row: Requisition, expected: RequisitionStatus, action: string): RuleResult {
  if (row.status !== expected) {
    const currentIndex = REQUISITION_STATUSES.indexOf(row.status)
    const targetIndex = REQUISITION_STATUSES.indexOf(expected)
    if (targetIndex < currentIndex) {
      return fail(`状态只能往前推进，「${row.status}」不能倒回「${expected}」，${action}被挡回`)
    }
    return fail(
      `不能跳级：当前在「${row.status}」，需先完成上一步才能${action}（目标档「${expected}」），操作已挡回`,
    )
  }
  return ok('')
}

/** 登记领用单：领用人当场签字。同一支药重复请领只算一次，全重复直接打回。 */
export function createRequisition(input: {
  cabinetNo: string
  vialCodesRaw: string
  receiverSign: string
}): RuleResult<{ id: number; qty: number; dropped: string[] }> {
  type Created = { id: number; qty: number; dropped: string[] }
  const stock = findStock(input.cabinetNo)
  if (!stock) {
    return fail<Created>(`没有编号为「${input.cabinetNo}」的专柜`)
  }
  const resolved = resolveStock(stock)
  if (resolved.kind !== 'none') {
    return fail<Created>(`专柜与品名相左，${resolved.decision} 请先按优先级仲裁订正，再登记领用`)
  }
  const receiver = input.receiverSign.trim()
  if (!receiver) {
    return fail<Created>('领用人必须签字后才能登记领用')
  }
  const incoming = parseVialCodes(input.vialCodesRaw)
  if (incoming.length === 0) {
    return fail<Created>('请至少填写一个支号（安瓿/瓶编号），剩余量按支点数')
  }
  const used = usedVialCodes(input.cabinetNo)
  const dropped: string[] = []
  const fresh: string[] = []
  for (const code of incoming) {
    if (used.has(code)) dropped.push(code)
    else fresh.push(code)
  }
  if (fresh.length === 0) {
    return fail<Created>(`支号 ${dropped.join('、')} 均已在他单请领，同一支药重复请领只算一次，本单打回`)
  }
  if (fresh.length > stock.remaining) {
    return fail<Created>(
      `请领 ${fresh.length} 支，但专柜剩余 ${stock.remaining} 支，账实不足，不能登记（请重新清点支号）`,
    )
  }
  const state = controlledState()
  const id = state.nextRequisitionId
  const row: Requisition = {
    id,
    cabinetNo: input.cabinetNo,
    productName: resolved.canonicalName,
    vialCodes: fresh,
    qty: fresh.length,
    receiverSign: receiver,
    reviewerSign: '',
    status: '待复核',
    issueDate: nowText(),
  }
  saveControlledState({
    ...state,
    requisitions: [...state.requisitions, row],
    nextRequisitionId: state.nextRequisitionId + 1,
  })
  const message =
    dropped.length > 0
      ? `领用单 ${id} 已登记（领用人 ${receiver} 签字）。支号 ${dropped.join('、')} 重复请领，已只算一次，实际计 ${fresh.length} 支`
      : `领用单 ${id} 已登记（领用人 ${receiver} 签字），计 ${fresh.length} 支，待双人复核`
  return { ok: true, message, data: { id, qty: fresh.length, dropped } }
}

/** 待签字的纸单补签：领用人签字后进入待复核。 */
export function signByReceiver(id: number, receiverSign: string): RuleResult {
  const state = controlledState()
  const row = state.requisitions.find((item) => item.id === id)
  if (!row) return fail(`没有编号为 ${id} 的领用单`)
  const guard = assertNextStep(row, '待签字', '由领用人签字')
  if (!guard.ok) return guard
  const receiver = receiverSign.trim()
  if (!receiver) return fail('领用人签字不能为空，单子被挡回')
  saveControlledState({
    ...state,
    requisitions: state.requisitions.map((item) =>
      item.id === id ? { ...item, receiverSign: receiver, status: '待复核' } : item,
    ),
  })
  return ok(`领用单 ${id} 已由领用人 ${receiver} 签字，进入待复核`)
}

/** 双人复核并发放：复核人签字且不得与领用人同人，扣减专柜剩余量（按支）。 */
export function issueRequisition(id: number, reviewerSign: string): RuleResult {
  const state = controlledState()
  const row = state.requisitions.find((item) => item.id === id)
  if (!row) return fail(`没有编号为 ${id} 的领用单`)
  const guard = assertNextStep(row, '待复核', '双人复核发放')
  if (!guard.ok) return guard
  const reviewer = reviewerSign.trim()
  if (!reviewer) return fail('双人复核要求复核人签字，未签字不得发放')
  if (reviewer === row.receiverSign) {
    return fail(`复核人「${reviewer}」与领用人为同一人，双人复核必须两人到场，发放被挡回`)
  }
  const stock = state.stocks.find((item) => item.cabinetNo === row.cabinetNo)
  if (!stock) return fail(`专柜 ${row.cabinetNo} 已不存在，无法发放`)
  const conflict = resolveStock(stock)
  if (conflict.kind !== 'none') {
    return fail(`专柜与品名相左未仲裁：${conflict.decision} 发放被挡回`)
  }
  // 发放前再点一次支号，防止登记后另有单子先领。
  const used = usedVialCodes(row.cabinetNo, row.id)
  const clash = row.vialCodes.filter((code) => used.has(code))
  if (clash.length > 0) {
    return fail(`支号 ${clash.join('、')} 已被其他单领走，同一支药只能算一次，发放被挡回`)
  }
  if (row.qty > stock.remaining) {
    return fail(`复核发放 ${row.qty} 支，但专柜仅剩 ${stock.remaining} 支，账实不足，发放被挡回`)
  }
  const nextStocks = state.stocks.map((item) =>
    item.cabinetNo === stock.cabinetNo ? { ...item, remaining: item.remaining - row.qty } : item,
  )
  const nextRows = state.requisitions.map((item) =>
    item.id === id ? { ...item, reviewerSign: reviewer, status: '已发放' as const } : item,
  )
  saveControlledState({ ...state, stocks: nextStocks, requisitions: nextRows })
  return ok(`领用单 ${id} 经复核人 ${reviewer} 双人复核，已发放 ${row.qty} 支；专柜剩余 ${stock.remaining - row.qty} 支`)
}

/** 已发放的单子同步到物料放行台账，同步后专柜栏进入「已同步」，两笔账即可对得上。 */
export function syncRequisition(id: number): RuleResult {
  const state = controlledState()
  const row = state.requisitions.find((item) => item.id === id)
  if (!row) return fail(`没有编号为 ${id} 的领用单`)
  const guard = assertNextStep(row, '已发放', '同步物料放行台账')
  if (!guard.ok) return guard
  const materialRowId = ensureIssueRow(row, resolvedName(row))
  saveControlledState({
    ...state,
    requisitions: state.requisitions.map((item) =>
      item.id === id ? { ...item, status: '已同步' as const, materialRowId } : item,
    ),
  })
  return ok(`领用单 ${id} 已同步到物料放行台账（台账行号 ${materialRowId}），两处剩余量可对得上`)
}

function resolvedName(row: Requisition): string {
  const stock = findStock(row.cabinetNo)
  return stock ? resolveStock(stock).canonicalName : row.productName
}

/** 盘点补登剩余量：只接受非负整数，非法值一律打回重填，不动任何账。 */
export function recountStock(cabinetNo: string, rawValue: string): RuleResult {
  const stock = findStock(cabinetNo)
  if (!stock) return fail(`没有编号为「${cabinetNo}」的专柜`)
  const trimmed = rawValue.trim()
  if (!/^\d+$/.test(trimmed)) {
    return fail(`剩余量「${rawValue}」不是合法支数（要求非负整数，按支点数），打回重填`)
  }
  const value = Number(trimmed)
  const state = controlledState()
  saveControlledState({
    ...state,
    stocks: state.stocks.map((item) =>
      item.cabinetNo === cabinetNo ? { ...item, remaining: value } : item,
    ),
  })
  const alarmText = value < stock.alarmLine ? `，已跌破报警线 ${stock.alarmLine} 支` : ''
  return ok(`专柜 ${cabinetNo} 盘点结存登记为 ${value} 支${alarmText}`)
}

/** 按目录订正专柜现场登记（优先级仲裁后的执行动作）。 */
export function correctByCatalog(cabinetNo: string): RuleResult {
  const stock = findStock(cabinetNo)
  if (!stock) return fail(`没有编号为「${cabinetNo}」的专柜`)
  const resolved = resolveStock(stock)
  if (resolved.kind === 'none') return ok(`专柜 ${cabinetNo} 本就与目录一致，无须订正`)
  if (resolved.kind === 'unknown') {
    return fail(`品名「${stock.productName}」目录查无，无更高优先级依据，不能擅自订正，先补目录`)
  }
  const state = controlledState()
  saveControlledState({
    ...state,
    stocks: state.stocks.map((item) =>
      item.cabinetNo === cabinetNo
        ? { ...item, productName: resolved.canonicalName, shelf: resolved.canonicalShelf }
        : item,
    ),
  })
  return ok(`已按品名目录将专柜 ${cabinetNo} 订正为「${resolved.canonicalName}」（${resolved.canonicalShelf}架）`)
}

function materialRows(): EntryRow[] {
  return listRows(MATERIAL_KEY)
}

function saveMaterialRows(rows: EntryRow[]): void {
  saveRows(MATERIAL_KEY, rows)
}

function nextMaterialRowId(rows: EntryRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

function issuedTotal(cabinetNo: string): number {
  return controlledState()
    .requisitions.filter(
      (row) =>
        row.cabinetNo === cabinetNo && (row.status === '已发放' || row.status === '已同步'),
    )
    .reduce((sum, row) => sum + row.qty, 0)
}

// 期初行号按「类别架号 + 柜序」编码，避免不同架上同序号的专柜撞号。
function openingRowId(resolved: ResolvedStock): number {
  const serial = Number(resolved.stock.cabinetNo.split('-')[1])
  return 8000 + DRUG_CATEGORIES.indexOf(resolved.canonicalShelf) * 100 + serial
}

function openingMaterialRow(resolved: ResolvedStock, openingQty: number): EntryRow {
  return {
    id: openingRowId(resolved),
    status: '已放行',
    pending: false,
    abnormal: false,
    物料批号: `${OPENING_PREFIX}${resolved.stock.cabinetNo}`,
    物料名称: resolved.canonicalName,
    供应商: `特殊管理药品专柜${resolved.stock.cabinetNo}`,
    检验单号: `受控期初-${resolved.stock.cabinetNo}`,
    放行数量: openingQty,
    放行人: '专柜期初建账',
    放行日期: '2026-09-01',
    放行状态: '已放行',
    台账来源: '特殊药品专柜期初',
    专柜编号: resolved.stock.cabinetNo,
  }
}

function issueMaterialRow(row: Requisition, productName: string, materialRowId: number): EntryRow {
  return {
    id: materialRowId,
    status: '已放行',
    pending: false,
    abnormal: false,
    物料批号: `${ISSUE_PREFIX}${row.id}（支号 ${row.vialCodes.join('、')}）`,
    物料名称: productName,
    供应商: `特殊管理药品专柜${row.cabinetNo}`,
    检验单号: `受控领用-${String(row.id).padStart(3, '0')}`,
    放行数量: row.qty,
    放行人: row.reviewerSign,
    放行日期: row.issueDate,
    放行状态: '已放行',
    台账来源: '特殊药品专柜领用',
    专柜编号: row.cabinetNo,
    领用登记号: row.id,
  }
}

/**
 * 把专柜卷的结存与已同步领用单铺到物料放行台账：
 * 每个专柜一行期初结存，每张已同步领用单一行放行；幂等，可反复调用。
 */
export function ensureMaterialLedger(): void {
  const state = controlledState()
  const rows = [...materialRows()]
  for (const stock of state.stocks) {
    const resolved = resolveStock(stock)
    const batchNo = `${OPENING_PREFIX}${stock.cabinetNo}`
    const openingQty = stock.remaining + issuedTotal(stock.cabinetNo)
    const index = rows.findIndex((row) => String(row.物料批号) === batchNo)
    const opening = openingMaterialRow(resolved, openingQty)
    if (index >= 0) rows[index] = { ...rows[index], ...opening, id: rows[index].id }
    else rows.push(opening)
  }
  for (const row of state.requisitions.filter((item) => item.status === '已同步')) {
    const batchNo = `${ISSUE_PREFIX}${row.id}`
    const exists = rows.some((item) => String(item.物料批号).startsWith(batchNo))
    if (exists) continue
    const materialRowId = row.materialRowId ?? 9200 + row.id
    rows.push(issueMaterialRow(row, resolvedName(row), materialRowId))
  }
  saveMaterialRows(rows)
}

function ensureIssueRow(row: Requisition, productName: string): number {
  ensureMaterialLedger()
  const rows = [...materialRows()]
  const batchNo = `${ISSUE_PREFIX}${row.id}`
  const existing = rows.find((item) => String(item.物料批号).startsWith(batchNo))
  if (existing) return Number(existing.id)
  const materialRowId = nextMaterialRowId(rows)
  rows.push(issueMaterialRow(row, productName, materialRowId))
  saveMaterialRows(rows)
  return materialRowId
}

/** 两支笔对账：专柜台账剩余量 vs 物料放行台账（期初结存－已同步放行）反推结存。 */
export function reconcile(): ReconcileItem[] {
  ensureMaterialLedger()
  const rows = materialRows()
  return controlledState().stocks.map((stock) => {
    const resolved = resolveStock(stock)
    const opening = rows.find(
      (row) => String(row.物料批号) === `${OPENING_PREFIX}${stock.cabinetNo}`,
    )
    const issuedFromMaterial = rows
      .filter(
        (row) =>
          String(row.台账来源) === '特殊药品专柜领用' &&
          String(row.专柜编号) === stock.cabinetNo,
      )
      .reduce((sum, row) => sum + Number(row.放行数量 || 0), 0)
    const openingQty = Number(opening?.放行数量 || 0)
    const materialRemaining = openingQty - issuedFromMaterial
    return {
      cabinetNo: stock.cabinetNo,
      productName: resolved.canonicalName,
      cabinetRemaining: stock.remaining,
      materialRemaining,
      matched: materialRemaining === stock.remaining,
    }
  })
}

export function listRequisitions(): Requisition[] {
  return controlledState().requisitions
}

export function statusCounts(): Record<RequisitionStatus, number> {
  const counts: Record<RequisitionStatus, number> = {
    待签字: 0,
    待复核: 0,
    已发放: 0,
    已同步: 0,
  }
  for (const row of controlledState().requisitions) counts[row.status] += 1
  return counts
}

export function resetLedger(): void {
  resetControlledState()
  // 重置后立即重铺物料台账期初与已同步行，两卷重新对齐。
  ensureMaterialLedger()
}

export function exportLedger(): { filename: string; content: string } {
  ensureMaterialLedger()
  const header = ['专柜编号', '货架类别', '品名', '剩余量(支)', '报警线(支)', '是否预警', '上一支领用人', '最近复核人']
  const lines = [header.join(',')]
  for (const resolved of resolvedStocks()) {
    const last = lastIssued(resolved.stock.cabinetNo)
    lines.push(
      [
        resolved.stock.cabinetNo,
        resolved.canonicalShelf,
        resolved.canonicalName,
        resolved.stock.remaining,
        resolved.stock.alarmLine,
        resolved.stock.remaining < resolved.stock.alarmLine ? '预警' : '正常',
        last?.receiverSign ?? '',
        last?.reviewerSign ?? '',
      ].join(','),
    )
  }
  return { filename: '特殊管理药品专柜台账.csv', content: `﻿${lines.join('\n')}` }
}

export { DRUG_CATEGORIES }
