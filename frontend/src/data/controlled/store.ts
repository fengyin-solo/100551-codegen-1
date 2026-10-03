import { CATALOG_SEED, REQUISITION_SEED, STOCK_SEED } from './seed'
import type { CabinetStock, DrugCatalogItem, Requisition } from './types'

// 特殊药品专柜台账独立成卷，不复用通用 EntryRow 的存储。
const STORAGE_KEY = 'pharma-cleanroom:controlled-drugs'

export type ControlledState = {
  catalog: DrugCatalogItem[]
  stocks: CabinetStock[]
  requisitions: Requisition[]
  nextRequisitionId: number
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function seedState(): ControlledState {
  return {
    catalog: clone(CATALOG_SEED),
    stocks: clone(STOCK_SEED),
    requisitions: clone(REQUISITION_SEED),
    nextRequisitionId: REQUISITION_SEED.length + 1,
  }
}

function readStorage(): ControlledState {
  const fallback = seedState()
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Partial<ControlledState>
    return {
      catalog: Array.isArray(parsed.catalog) ? (parsed.catalog as DrugCatalogItem[]) : fallback.catalog,
      stocks: Array.isArray(parsed.stocks) ? (parsed.stocks as CabinetStock[]) : fallback.stocks,
      requisitions: Array.isArray(parsed.requisitions)
        ? (parsed.requisitions as Requisition[])
        : fallback.requisitions,
      nextRequisitionId:
        typeof parsed.nextRequisitionId === 'number' ? parsed.nextRequisitionId : fallback.nextRequisitionId,
    }
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: ControlledState | null = null

export function controlledState(): ControlledState {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function saveControlledState(state: ControlledState): void {
  cache = state
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  }
}

export function resetControlledState(): ControlledState {
  const state = seedState()
  saveControlledState(state)
  return state
}

export function controlledStorageKey(): string {
  return STORAGE_KEY
}
