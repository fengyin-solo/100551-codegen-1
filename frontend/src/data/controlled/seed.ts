import type { CabinetStock, DrugCatalogItem, Requisition } from './types'

// 品名目录：毒麻精放四架各列常管品种，目录是优先级最高的一份账。
export const CATALOG_SEED: DrugCatalogItem[] = [
  { name: '盐酸吗啡注射液', category: '麻醉药品', spec: '10mg:1ml/支' },
  { name: '枸橼酸芬太尼注射液', category: '麻醉药品', spec: '0.1mg:2ml/支' },
  { name: '盐酸哌替啶注射液', category: '麻醉药品', spec: '100mg:2ml/支' },
  { name: '地西泮注射液', category: '精神药品', spec: '10mg:2ml/支' },
  { name: '盐酸氯胺酮注射液', category: '精神药品', spec: '100mg:2ml/支', aliases: ['氯胺酮水针'] },
  { name: '注射用A型肉毒毒素', category: '毒性药品', spec: '100IU/支' },
  { name: '亚砷酸氯化钠注射液', category: '毒性药品', spec: '10mg:10ml/支' },
  { name: '碘[131I]化钠口服溶液', category: '放射性药品', spec: '100mCi/支' },
]

// 专柜台账初始栏：一专柜一栏。精-02 现场记成「氯胺酮水针」，与目录相左，留作优先级仲裁演示。
export const STOCK_SEED: CabinetStock[] = [
  { cabinetNo: '毒-01', productName: '注射用A型肉毒毒素', shelf: '毒性药品', alarmLine: 4, remaining: 6 },
  { cabinetNo: '毒-02', productName: '亚砷酸氯化钠注射液', shelf: '毒性药品', alarmLine: 5, remaining: 9 },
  { cabinetNo: '麻-01', productName: '盐酸吗啡注射液', shelf: '麻醉药品', alarmLine: 10, remaining: 8 },
  { cabinetNo: '麻-02', productName: '枸橼酸芬太尼注射液', shelf: '麻醉药品', alarmLine: 10, remaining: 25 },
  { cabinetNo: '麻-03', productName: '盐酸哌替啶注射液', shelf: '麻醉药品', alarmLine: 5, remaining: 4 },
  { cabinetNo: '精-01', productName: '地西泮注射液', shelf: '精神药品', alarmLine: 6, remaining: 18 },
  { cabinetNo: '精-02', productName: '氯胺酮水针', shelf: '精神药品', alarmLine: 5, remaining: 3 },
  { cabinetNo: '放-01', productName: '碘[131I]化钠口服溶液', shelf: '放射性药品', alarmLine: 3, remaining: 7 },
]

// 近期领用登记。剩余量只随「已发放/已同步」扣减；待签字、待复核的单子尚未动柜存。
export const REQUISITION_SEED: Requisition[] = [
  {
    id: 1, cabinetNo: '麻-01', productName: '盐酸吗啡注射液',
    vialCodes: ['MA-0091', 'MA-0092'], qty: 2,
    receiverSign: '王磊', reviewerSign: '李静', status: '已同步', issueDate: '2026-10-01 09:12',
    materialRowId: 9101,
  },
  {
    id: 2, cabinetNo: '麻-01', productName: '盐酸吗啡注射液',
    vialCodes: ['MA-0090'], qty: 1,
    receiverSign: '王芳', reviewerSign: '李静', status: '已发放', issueDate: '2026-10-02 14:40',
  },
  {
    id: 3, cabinetNo: '麻-02', productName: '枸橼酸芬太尼注射液',
    vialCodes: ['FE-0073', 'FE-0074', 'FE-0075'], qty: 3,
    receiverSign: '张倩', reviewerSign: '周明', status: '已同步', issueDate: '2026-10-01 10:05',
    materialRowId: 9102,
  },
  {
    id: 4, cabinetNo: '麻-03', productName: '盐酸哌替啶注射液',
    vialCodes: ['PE-0095', 'PE-0096'], qty: 2,
    receiverSign: '王磊', reviewerSign: '周明', status: '已同步', issueDate: '2026-10-01 11:20',
    materialRowId: 9103,
  },
  {
    id: 5, cabinetNo: '精-01', productName: '地西泮注射液',
    vialCodes: ['DI-0079', 'DI-0080', 'DI-0081', 'DI-0082'], qty: 4,
    receiverSign: '陈晨', reviewerSign: '', status: '待复核', issueDate: '2026-10-03 08:30',
  },
  {
    id: 6, cabinetNo: '精-02', productName: '盐酸氯胺酮注射液',
    vialCodes: ['KE-0097'], qty: 1,
    receiverSign: '赵雪', reviewerSign: '周明', status: '已同步', issueDate: '2026-10-01 15:45',
    materialRowId: 9104,
  },
  {
    id: 7, cabinetNo: '毒-01', productName: '注射用A型肉毒毒素',
    vialCodes: ['BT-0093', 'BT-0094'], qty: 2,
    receiverSign: '孙琳', reviewerSign: '李静', status: '已同步', issueDate: '2026-10-02 09:30',
    materialRowId: 9105,
  },
  {
    id: 8, cabinetNo: '毒-02', productName: '亚砷酸氯化钠注射液',
    vialCodes: ['AR-0091'], qty: 1,
    receiverSign: '', reviewerSign: '', status: '待签字', issueDate: '2026-10-03 09:02',
  },
  {
    id: 9, cabinetNo: '放-01', productName: '碘[131I]化钠口服溶液',
    vialCodes: ['RA-0091', 'RA-0092', 'RA-0093'], qty: 3,
    receiverSign: '陈晨', reviewerSign: '李静', status: '已同步', issueDate: '2026-10-02 16:10',
    materialRowId: 9106,
  },
]
