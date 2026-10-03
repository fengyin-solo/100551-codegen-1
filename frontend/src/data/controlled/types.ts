/** 特殊管理药品（毒、麻、精、放）专柜台账领域模型。与通用 EntryRow 分开记账，规则自带校验。 */

// 药品类别即货架：毒性、麻醉、精神、放射性各分一架专柜。
export const DRUG_CATEGORIES = ['毒性药品', '麻醉药品', '精神药品', '放射性药品'] as const
export type DrugCategory = (typeof DRUG_CATEGORIES)[number]

// 领用单只能沿这四档一档档往前推，不允许跳级。
export const REQUISITION_STATUSES = ['待签字', '待复核', '已发放', '已同步'] as const
export type RequisitionStatus = (typeof REQUISITION_STATUSES)[number]

/** 品名目录：品名的法定归属以目录为准，是优先级最高的一份账。 */
export type DrugCatalogItem = {
  name: string
  category: DrugCategory
  spec: string
  /** 现场曾用名/俗称：现场栏写了别名时，按别名能找回目录正名。 */
  aliases?: string[]
}

/** 专柜台账栏：一专柜一栏，按类别分架陈列。 */
export type CabinetStock = {
  /** 专柜编号，如 毒-01 */
  cabinetNo: string
  /** 专柜现场登记的品名，可能与目录相左，相左时先判优先级再定按哪一份。 */
  productName: string
  /** 专柜所在货架（类别） */
  shelf: DrugCategory
  /** 报警线：剩余量（支）跌破此值即列入低水位预警 */
  alarmLine: number
  /** 当前剩余量（支） */
  remaining: number
}

/** 领用登记：一支药一条去向。 */
export type Requisition = {
  id: number
  cabinetNo: string
  productName: string
  /** 本次请领涉及的支号（安瓿/瓶的唯一编号），用于同一支药重复请领只算一次。 */
  vialCodes: string[]
  /** 实际计入的支数（支号去重后） */
  qty: number
  receiverSign: string
  reviewerSign: string
  status: RequisitionStatus
  issueDate: string
  /** 发放后同步到物料放行台账的行号，未同步为空 */
  materialRowId?: number
}

/** 两支笔对账的结果：专柜台账剩余量 vs 物料放行台账反推结存。 */
export type ReconcileItem = {
  cabinetNo: string
  productName: string
  cabinetRemaining: number
  materialRemaining: number
  matched: boolean
}

export type RuleResult<T = undefined> = {
  ok: boolean
  message: string
  data?: T
}
