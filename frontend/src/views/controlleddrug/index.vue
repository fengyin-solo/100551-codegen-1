<template>
  <section class="page" data-module="controlleddrug">
    <header class="page-head">
      <div>
        <h2>特殊管理药品专柜台账</h2>
        <p class="page-desc">
          毒、麻、精、放药品专柜分架立卷：逐栏登记品名、领用去向、剩余量（支）与双人复核；
          状态逐档推进不得跳级，同一支药重复请领只算一次，发放结果同步物料放行台账并逐栏对账。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="exportLedger">导出台账</button>
        <button class="btn" type="button" @click="resetLedger">重置演示数据</button>
      </div>
    </header>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">专柜栏数</span>
        <strong class="stat-value">{{ stocks.length }}</strong>
      </article>
      <article class="stat-card" :class="{ alert: lowWater.length }">
        <span class="stat-label">跌破报警线</span>
        <strong class="stat-value">{{ lowWater.length }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">待双人复核</span>
        <strong class="stat-value">{{ counts.待复核 }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">已发放待同步</span>
        <strong class="stat-value">{{ counts.已发放 }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">账账不符栏</span>
        <strong class="stat-value" :class="{ 'error-text': mismatchCount }">{{ mismatchCount }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <!-- 剩余量跌破报警线的栏单独展示 -->
    <section v-if="lowWater.length" class="alarm-panel">
      <h3 class="panel-title danger">⚠ 低水位预警（剩余量已跌破报警线）</h3>
      <div class="cabinet-grid">
        <article v-for="item in lowWater" :key="item.stock.cabinetNo" class="cabinet-card alarm-card">
          <CabinetCardBody :item="item" :last="lastMap[item.stock.cabinetNo]" />
          <footer class="card-foot">
            <button class="link" type="button" @click="openRecount(item.stock.cabinetNo)">盘点补登</button>
            <button v-if="item.kind !== 'none'" class="link" type="button" @click="correct(item.stock.cabinetNo)">
              按目录订正
            </button>
          </footer>
        </article>
      </div>
    </section>

    <!-- 专柜按药品类别分架，逐栏陈列 -->
    <section v-for="category in categories" :key="category" class="shelf-block">
      <h3 class="panel-title">{{ category }}架</h3>
      <div class="cabinet-grid">
        <article
          v-for="item in byShelf(category)"
          :key="item.stock.cabinetNo"
          class="cabinet-card"
          :class="{ 'alarm-card': item.stock.remaining < item.stock.alarmLine }"
        >
          <CabinetCardBody :item="item" :last="lastMap[item.stock.cabinetNo]" />
          <footer class="card-foot">
            <button class="link" type="button" @click="openRecount(item.stock.cabinetNo)">盘点补登</button>
            <button v-if="item.kind !== 'none'" class="link" type="button" @click="correct(item.stock.cabinetNo)">
              按目录订正
            </button>
          </footer>
        </article>
      </div>
    </section>

    <!-- 两支笔对账 -->
    <section class="reconcile-block">
      <h3 class="panel-title">两账核对：专柜卷 × 物料放行台账</h3>
      <p class="page-desc">
        物料放行台账按「期初结存 − 专柜领用放行」反推结存，与专柜剩余量逐栏比对；
        已发放未同步的单子会先表现为差异，同步后即对得上。
      </p>
      <table class="data-table">
        <thead>
          <tr>
            <th>专柜编号</th><th>品名</th><th>专柜剩余量(支)</th><th>物料台账反推(支)</th><th>核对</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in reconcileRows" :key="row.cabinetNo">
            <td>{{ row.cabinetNo }}</td>
            <td>{{ row.productName }}</td>
            <td>{{ row.cabinetRemaining }}</td>
            <td>{{ row.materialRemaining }}</td>
            <td>
              <span :class="row.matched ? 'ok-text' : 'error-text'">
                {{ row.matched ? '✓ 对得上' : `✗ 差 ${row.materialRemaining - row.cabinetRemaining} 支（待同步）` }}
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <!-- 领用登记 -->
    <section class="requisition-block">
      <h3 class="panel-title">领用登记</h3>
      <form class="entry-form" @submit.prevent="submitCreate">
        <label class="form-item">
          <span>领用专柜</span>
          <select v-model="form.cabinetNo">
            <option value="" disabled>请选择专柜</option>
            <option
              v-for="item in stocks"
              :key="item.stock.cabinetNo"
              :value="item.stock.cabinetNo"
              :disabled="item.kind !== 'none'"
            >
              {{ item.stock.cabinetNo }} · {{ item.canonicalName }}
              （剩 {{ item.stock.remaining }} 支）{{ item.kind !== 'none' ? '｜专柜品名相左，停用' : '' }}
            </option>
          </select>
        </label>
        <label class="form-item grow">
          <span>支号（多个用顿号/逗号/空格分隔，按支点数）</span>
          <input v-model="form.vialCodesRaw" placeholder="如 MA-0098、MA-0099" />
        </label>
        <label class="form-item">
          <span>领用人签字</span>
          <input v-model="form.receiverSign" placeholder="领用人当场签字" />
        </label>
        <button class="btn primary" type="submit">登记领用</button>
      </form>
      <p v-if="formMessage" :class="formOk ? 'ok-text' : 'error-text'" class="form-msg">{{ formMessage }}</p>

      <form class="filter-bar" @submit.prevent>
        <label class="filter-item">
          <span>按专柜筛选</span>
          <select v-model="cabinetFilter">
            <option value="">全部专柜</option>
            <option v-for="item in stocks" :key="item.stock.cabinetNo" :value="item.stock.cabinetNo">
              {{ item.stock.cabinetNo }} · {{ item.canonicalName }}
            </option>
          </select>
        </label>
      </form>

      <table class="data-table">
        <thead>
          <tr>
            <th>单号</th><th>专柜</th><th>品名</th><th>支号</th><th>支数</th>
            <th>领用人签字</th><th>复核人签字</th><th>登记时间</th><th>当前状态</th><th>可执行动作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in filteredRequisitions" :key="row.id">
            <td>{{ row.id }}</td>
            <td>{{ row.cabinetNo }}</td>
            <td>{{ row.productName }}</td>
            <td class="vial-cell">{{ row.vialCodes.join('、') }}</td>
            <td>{{ row.qty }}</td>
            <td>{{ row.receiverSign || '未签' }}</td>
            <td>{{ row.reviewerSign || '—' }}</td>
            <td>{{ row.issueDate }}</td>
            <td><span class="status-pill" :data-status="row.status">{{ row.status }}</span></td>
            <td class="row-actions">
              <button v-if="row.status === '待签字'" class="link" type="button" @click="openSign(row.id, 'receiver')">
                领用人补签
              </button>
              <button v-if="row.status === '待复核'" class="link" type="button" @click="openSign(row.id, 'reviewer')">
                双人复核发放
              </button>
              <button v-if="row.status === '已发放'" class="link" type="button" @click="sync(row.id)">
                同步物料放行
              </button>
              <span v-if="row.status === '已同步'" class="muted">台账行号 {{ row.materialRowId }}</span>
            </td>
          </tr>
          <tr v-if="!filteredRequisitions.length">
            <td colspan="10" class="empty-state">暂无领用登记</td>
          </tr>
        </tbody>
      </table>
    </section>

    <!-- 签字弹层：领用人补签 / 复核人签字 -->
    <div v-if="signModal.open" class="modal-mask" @click.self="closeSign">
      <div class="modal">
        <h4>{{ signModal.mode === 'reviewer' ? '双人复核发放' : '领用人签字' }}</h4>
        <p class="page-desc">
          {{ signModal.mode === 'reviewer'
            ? '毒麻精放药品发放须双人复核，复核人不得与领用人为同一人；复核后按支扣减专柜剩余量。'
            : '领用单须由领用人本人签字后方可进入双人复核。' }}
        </p>
        <input
          v-model="signModal.value"
          :placeholder="signModal.mode === 'reviewer' ? '复核人签字' : '领用人签字'"
          @keyup.enter="confirmSign"
        />
        <p v-if="signModal.error" class="error-text form-msg">{{ signModal.error }}</p>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="closeSign">取消</button>
          <button class="btn primary" type="button" @click="confirmSign">确认签字</button>
        </div>
      </div>
    </div>

    <!-- 盘点补登弹层：非法值打回重填 -->
    <div v-if="recountModal.open" class="modal-mask" @click.self="closeRecount">
      <div class="modal">
        <h4>盘点补登剩余量 · {{ recountModal.cabinetNo }}</h4>
        <p class="page-desc">剩余量按支点数，只接受非负整数；填成小数、负数或文字一律打回重填，账面不动。</p>
        <input
          v-model="recountModal.value"
          placeholder="请输入盘点结存支数，如 12"
          @keyup.enter="confirmRecount"
        />
        <p v-if="recountModal.error" class="error-text form-msg">{{ recountModal.error }}</p>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="closeRecount">取消</button>
          <button class="btn primary" type="button" @click="confirmRecount">登记结存</button>
        </div>
      </div>
    </div>

    <footer class="page-foot">
      <span>专柜台账独立成卷保存在本机浏览器；发放后同步物料放行台账，两处剩余量逐栏可对。</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, defineComponent, h, onMounted, reactive, ref } from 'vue'

import type { Requisition } from '@/data/controlled/types'
import type { ResolvedStock } from '@/data/controlled/service'
import {
  correctByCatalog,
  createRequisition,
  ensureMaterialLedger,
  exportLedger as exportLedgerData,
  issueRequisition,
  lastIssued,
  listRequisitions,
  lowWaterStocks,
  reconcile,
  recountStock,
  resetLedger as resetLedgerData,
  resolvedStocks,
  signByReceiver,
  statusCounts,
  syncRequisition,
} from '@/data/controlled/service'
import { DRUG_CATEGORIES, REQUISITION_STATUSES } from '@/data/controlled/types'

// 专柜栏卡片（品名/领用登记/剩余量/复核人 + 冲突仲裁提示），预警区与各架复用。
const CabinetCardBody = defineComponent({
  props: {
    item: { type: Object as () => ResolvedStock, required: true },
    last: { type: Object as () => Requisition | undefined, required: false },
  },
  setup(props) {
    return () =>
      h('div', { class: 'card-body' }, [
        h('div', { class: 'card-top' }, [
          h('strong', { class: 'cabinet-no' }, props.item.stock.cabinetNo),
          h(
            'span',
            {
              class: ['remain-pill', props.item.stock.remaining < props.item.stock.alarmLine ? 'danger' : 'ok'],
            },
            `剩 ${props.item.stock.remaining} 支 / 线 ${props.item.stock.alarmLine}`,
          ),
        ]),
        h('div', { class: 'card-name' }, [
          props.item.kind === 'nameMismatch'
            ? h('span', { class: 'muted' }, `现场名「${props.item.stock.productName}」→ 目录正名「${props.item.canonicalName}」`)
            : h('span', null, props.item.canonicalName),
        ]),
        props.item.kind !== 'none'
          ? h('p', { class: 'conflict-text' }, props.item.decision)
          : null,
        h('dl', { class: 'card-meta' }, [
          h('dt', null, '上一支领用'),
          h('dd', null, props.last ? `${props.last.receiverSign}（${props.last.qty} 支）` : '—'),
          h('dt', null, '复核人'),
          h('dd', null, props.last?.reviewerSign || '—'),
        ]),
      ])
  },
})

const categories = DRUG_CATEGORIES

const stocks = ref<ResolvedStock[]>([])
const reconcileRows = ref<ReturnType<typeof reconcile>>([])
const requisitions = ref<Requisition[]>([])
const counts = ref(statusCounts())
const errorMessage = ref('')
const cabinetFilter = ref('')

const form = reactive({ cabinetNo: '', vialCodesRaw: '', receiverSign: '' })
const formMessage = ref('')
const formOk = ref(false)

const signModal = reactive({ open: false, id: 0, mode: 'receiver' as 'receiver' | 'reviewer', value: '', error: '' })
const recountModal = reactive({ open: false, cabinetNo: '', value: '', error: '' })

const lowWater = computed(() => stocks.value.filter((item) => item.stock.remaining < item.stock.alarmLine))
const mismatchCount = computed(() => reconcileRows.value.filter((row) => !row.matched).length)

const lastMap = computed<Record<string, Requisition | undefined>>(() => {
  const map: Record<string, Requisition | undefined> = {}
  for (const item of stocks.value) map[item.stock.cabinetNo] = lastIssued(item.stock.cabinetNo)
  return map
})

const statusSummary = computed(() =>
  REQUISITION_STATUSES.map((status) => ({ status, count: counts.value[status] })),
)

const filteredRequisitions = computed(() =>
  cabinetFilter.value
    ? requisitions.value.filter((row) => row.cabinetNo === cabinetFilter.value)
    : requisitions.value,
)

function byShelf(category: string): ResolvedStock[] {
  return stocks.value.filter((item) => item.canonicalShelf === category)
}

function reload(message = '', okFlag = false) {
  stocks.value = resolvedStocks()
  requisitions.value = [...listRequisitions()].sort((a, b) => b.id - a.id)
  counts.value = statusCounts()
  reconcileRows.value = reconcile()
  errorMessage.value = okFlag ? '' : message
  if (message) {
    formMessage.value = message
    formOk.value = okFlag
  }
}

function submitCreate() {
  const result = createRequisition({ ...form })
  reload(result.message, result.ok)
  if (result.ok) {
    form.cabinetNo = ''
    form.vialCodesRaw = ''
    form.receiverSign = ''
  }
}

function openSign(id: number, mode: 'receiver' | 'reviewer') {
  signModal.open = true
  signModal.id = id
  signModal.mode = mode
  signModal.value = ''
  signModal.error = ''
}

function closeSign() {
  signModal.open = false
}

function confirmSign() {
  const result =
    signModal.mode === 'reviewer'
      ? issueRequisition(signModal.id, signModal.value)
      : signByReceiver(signModal.id, signModal.value)
  if (!result.ok) {
    signModal.error = result.message
    return
  }
  signModal.open = false
  reload(result.message, true)
}

function sync(id: number) {
  const result = syncRequisition(id)
  reload(result.message, result.ok)
}

function correct(cabinetNo: string) {
  const result = correctByCatalog(cabinetNo)
  reload(result.message, result.ok)
}

function openRecount(cabinetNo: string) {
  recountModal.open = true
  recountModal.cabinetNo = cabinetNo
  recountModal.value = ''
  recountModal.error = ''
}

function closeRecount() {
  recountModal.open = false
}

function confirmRecount() {
  const result = recountStock(recountModal.cabinetNo, recountModal.value)
  if (!result.ok) {
    recountModal.error = result.message
    return
  }
  recountModal.open = false
  reload(result.message, true)
}

function exportLedger() {
  const { filename, content } = exportLedgerData()
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

function resetLedger() {
  resetLedgerData()
  cabinetFilter.value = ''
  reload('专柜台账与物料放行同步行已重置回示例数据', true)
}

onMounted(() => {
  ensureMaterialLedger()
  reload()
})
</script>

<style scoped>
.panel-title { font-size: 15px; margin: 18px 0 8px; }
.panel-title.danger { color: #b42318; }
.alarm-panel { background: #fef3f2; border: 1px solid #fecdca; border-radius: 8px; padding: 10px 12px; }
.shelf-block { margin-top: 8px; }
.cabinet-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; }
.cabinet-card {
  background: #fff; border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px;
  display: flex; flex-direction: column; justify-content: space-between;
}
.cabinet-card.alarm-card { border-color: #f04438; box-shadow: 0 0 0 1px #fecdca inset; }
.card-top { display: flex; justify-content: space-between; align-items: center; }
.cabinet-no { font-size: 14px; }
.remain-pill { font-size: 12px; border-radius: 999px; padding: 2px 10px; }
.remain-pill.ok { background: #ecfdf3; color: #027a48; }
.remain-pill.danger { background: #fef3f2; color: #b42318; }
.card-name { margin: 6px 0 4px; font-size: 13px; }
.card-meta { display: grid; grid-template-columns: auto 1fr; gap: 2px 10px; margin: 6px 0 0; font-size: 12px; }
.card-meta dt { color: var(--muted); }
.card-meta dd { margin: 0; }
.conflict-text { margin: 4px 0; font-size: 12px; color: #b54708; background: #fffaeb; border-radius: 4px; padding: 4px 6px; }
.card-foot { display: flex; gap: 12px; margin-top: 8px; border-top: 1px dashed var(--border); padding-top: 6px; }
.stat-card.alert { border-color: #f04438; }
.reconcile-block, .requisition-block { margin-top: 18px; }
.entry-form { display: flex; flex-wrap: wrap; gap: 10px; align-items: flex-end; background: #fff; border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; margin-bottom: 8px; }
.form-item { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--muted); }
.form-item.grow { flex: 1; min-width: 260px; }
.form-item input, .form-item select { min-width: 180px; padding: 6px 8px; border: 1px solid var(--border); border-radius: 6px; font-size: 13px; }
.form-item.grow input { min-width: 0; width: 100%; }
.form-msg { font-size: 12px; margin: 4px 0 8px; }
.ok-text { color: #027a48; }
.muted { color: var(--muted); font-size: 12px; }
.vial-cell { font-size: 12px; max-width: 220px; }
.status-pill { border-radius: 999px; padding: 2px 8px; font-size: 12px; background: #eef2f7; }
.status-pill[data-status='待签字'] { background: #f2f4f7; color: #475467; }
.status-pill[data-status='待复核'] { background: #fffaeb; color: #b54708; }
.status-pill[data-status='已发放'] { background: #eff8ff; color: #175cd3; }
.status-pill[data-status='已同步'] { background: #ecfdf3; color: #027a48; }
.modal-mask { position: fixed; inset: 0; background: rgba(16, 24, 40, 0.45); display: flex; align-items: center; justify-content: center; z-index: 50; }
.modal { background: #fff; border-radius: 10px; padding: 18px 20px; width: 420px; max-width: 92vw; }
.modal h4 { margin: 0 0 8px; }
.modal input { width: 100%; padding: 8px 10px; border: 1px solid var(--border); border-radius: 6px; margin: 10px 0 4px; }
.modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
</style>
