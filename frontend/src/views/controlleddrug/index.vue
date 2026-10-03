<template>
  <section class="page" data-module="controlleddrug">
    <header class="page-head">
      <div>
        <h2>特殊管理药品专柜台账</h2>
        <p class="page-desc">毒麻精放药品另起一卷专柜台账：按药品类别分架、按专柜分栏，逐栏登记品名、领用、剩余量与双人复核，跌破报警线的专柜单独预警，归档结果同步物料放行台账。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="showForm = !showForm">
          {{ showForm ? '收起登记' : '登记领用' }}
        </button>
        <button class="btn" type="button" @click="exportRows">导出台账清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <section v-if="alarmCabinets.length" class="alarm-zone">
      <h3>报警专柜：剩余量已跌破报警线（{{ alarmCabinets.length }} 栏）</h3>
      <div class="cabinet-grid">
        <article v-for="cabinet in alarmCabinets" :key="`alarm-${cabinet.id}`" class="cabinet-card alarm">
          <header class="cabinet-head">
            <strong>{{ cabinet.id }}</strong>
            <span>{{ cabinet.category }} · {{ cabinet.shelf }}</span>
          </header>
          <p class="cabinet-line">品名：{{ cabinet.drugName }}（{{ cabinet.spec }}）</p>
          <p class="cabinet-line">
            剩余量
            <strong class="remaining alarm-text">{{ cabinet.remaining }} 支</strong>
            / 报警线 {{ cabinet.alarmLine }} 支
          </p>
          <p class="cabinet-line">复核人：{{ cabinet.reviewer }}</p>
        </article>
      </div>
    </section>

    <form v-if="showForm" class="entry-form" @submit.prevent="submitDispense">
      <label>
        <span>专柜</span>
        <select v-model="form.专柜编号">
          <option v-for="cabinet in cabinets" :key="cabinet.id" :value="cabinet.id">
            {{ cabinet.id }}（{{ cabinet.category }} · {{ cabinet.shelf }}）
          </option>
        </select>
      </label>
      <label>
        <span>品名</span>
        <select v-model="form.品名">
          <option v-for="(info, name) in catalog" :key="name" :value="name">
            {{ name }}（法定：{{ info.category }}）
          </option>
        </select>
      </label>
      <label>
        <span>请领单号</span>
        <input v-model="form.请领单号" placeholder="如 CTRL-0006" />
      </label>
      <label>
        <span>领用数量（支）</span>
        <input v-model="form.领用数量" placeholder="按支点数" />
      </label>
      <label>
        <span>实盘剩余量（支）</span>
        <input v-model="form.剩余量" placeholder="非负整数" />
      </label>
      <label>
        <span>领用人签字</span>
        <input v-model="form.领用人签字" placeholder="领用人亲笔签字" />
      </label>
      <label>
        <span>复核人签字</span>
        <input v-model="form.复核人签字" placeholder="复核人亲笔签字" />
      </label>
      <label>
        <span>领用日期</span>
        <input v-model="form.领用日期" type="date" />
      </label>
      <button class="btn primary" type="submit">提交登记</button>
    </form>

    <section v-for="group in categoryGroups" :key="group.category" class="category-section">
      <h3>{{ group.category }}</h3>
      <div class="cabinet-grid">
        <article
          v-for="cabinet in group.cabinets"
          :key="cabinet.id"
          class="cabinet-card"
          :class="{ alarm: cabinet.alarm }"
        >
          <header class="cabinet-head">
            <strong>{{ cabinet.id }}</strong>
            <span>{{ cabinet.shelf }}</span>
          </header>
          <p class="cabinet-line">品名：{{ cabinet.drugName }}（{{ cabinet.spec }}）</p>
          <p class="cabinet-line">
            剩余量
            <strong class="remaining" :class="{ 'alarm-text': cabinet.alarm }">{{ cabinet.remainingText }}</strong>
            / 报警线 {{ cabinet.alarmLine }} 支
          </p>
          <p class="cabinet-line">复核人：{{ cabinet.reviewer }}</p>
          <table class="mini-table">
            <thead>
              <tr>
                <th>请领单号</th>
                <th>领用</th>
                <th>领用人签字</th>
                <th>复核人签字</th>
                <th>日期</th>
                <th>状态</th>
                <th>动作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="entry in cabinet.entries" :key="String(entry.id)">
                <td>{{ entry['请领单号'] }}</td>
                <td>{{ entry['领用数量'] }} 支</td>
                <td>{{ entry['领用人签字'] }}</td>
                <td>{{ entry['复核人签字'] }}</td>
                <td>{{ entry['领用日期'] }}</td>
                <td>
                  {{ entry.status }}
                  <span v-if="entry.abnormal" class="flag-abnormal" title="专柜与品名类别相左，已按法定目录裁决">类别裁决</span>
                </td>
                <td class="row-actions">
                  <button
                    v-for="action in actions"
                    :key="action"
                    class="link"
                    type="button"
                    @click="runLedgerAction(action, entry)"
                  >
                    {{ action }}
                  </button>
                </td>
              </tr>
              <tr v-if="!cabinet.entries.length">
                <td colspan="7" class="empty-state">该柜暂无领用登记</td>
              </tr>
            </tbody>
          </table>
        </article>
      </div>
    </section>

    <section class="reconcile-zone">
      <h3>与物料放行台账对账（剩余量两处核对）</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>专柜</th>
            <th>品名</th>
            <th>专柜台账剩余量</th>
            <th>物料放行台账数量</th>
            <th>对账结果</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in reconcileRows" :key="row.专柜编号">
            <td>{{ row.专柜编号 }}</td>
            <td>{{ row.品名 }}</td>
            <td>{{ row.台账剩余量 === null ? '—' : `${row.台账剩余量} 支` }}</td>
            <td>{{ row.放行数量 === null ? '—' : `${row.放行数量} 支` }}</td>
            <td :class="row.一致 ? 'match-ok' : 'match-bad'">{{ row.说明 }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <footer class="page-foot">
      <span>共 {{ total }} 笔领用登记 · 状态只能一步步推进，跳级会被挡回</span>
      <span v-if="noticeMessage" class="notice-text">{{ noticeMessage }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { downloadEntries } from '@/api/local-service'
import {
  CABINETS,
  DRUG_CATALOG,
  MODULE_KEY,
  advanceLedger,
  reconcileRemaining,
  registerDispense,
  type ReconcileRow,
} from '@/api/controlled-drug'
import { listRows } from '@/data/local-store'
import type { EntryRow } from '@/data/types'

const cabinets = CABINETS
const catalog = DRUG_CATALOG
const actions = ['复核签字', '归档同步']

const rows = ref<EntryRow[]>([])
const reconcileRows = ref<ReconcileRow[]>([])
const errorMessage = ref('')
const noticeMessage = ref('')
const showForm = ref(false)

const today = new Date().toISOString().slice(0, 10)
const blankForm = () => ({
  专柜编号: CABINETS[0].id,
  品名: Object.keys(DRUG_CATALOG)[0],
  请领单号: '',
  领用数量: '',
  剩余量: '',
  领用人签字: '',
  复核人签字: '',
  领用日期: today,
})
const form = ref(blankForm())

type CabinetView = {
  id: string
  category: string
  shelf: string
  drugName: string
  spec: string
  remaining: number | null
  remainingText: string
  alarmLine: number | string
  reviewer: string
  alarm: boolean
  entries: EntryRow[]
}

function buildCabinetView(cabinet: (typeof CABINETS)[number]): CabinetView {
  const entries = rows.value
    .filter((row) => String(row['专柜编号']) === cabinet.id)
    .sort((a, b) => Number(b.id) - Number(a.id))
  const latest = entries[0] ?? null
  const remaining = latest ? Number(latest['剩余量']) : null
  const alarmLine = latest ? Number(latest['报警线']) : '—'
  return {
    id: cabinet.id,
    category: cabinet.category,
    shelf: cabinet.shelf,
    drugName: latest ? String(latest['品名']) : '—',
    spec: latest ? String(latest['规格']) : '—',
    remaining,
    remainingText: remaining === null ? '—' : `${remaining} 支`,
    alarmLine,
    reviewer: latest ? String(latest['复核人签字']) : '—',
    alarm: remaining !== null && typeof alarmLine === 'number' && remaining < alarmLine,
    entries,
  }
}

const cabinetViews = computed(() => cabinets.map(buildCabinetView))
const alarmCabinets = computed(() => cabinetViews.value.filter((cabinet) => cabinet.alarm))
const categoryGroups = computed(() => {
  const groups: { category: string; cabinets: CabinetView[] }[] = []
  for (const cabinet of cabinetViews.value) {
    let group = groups.find((item) => item.category === cabinet.category)
    if (!group) {
      group = { category: cabinet.category, cabinets: [] }
      groups.push(group)
    }
    group.cabinets.push(cabinet)
  }
  return groups
})

const total = computed(() => rows.value.length)
const stats = computed(() => [
  { label: '在册专柜数', value: cabinets.length },
  { label: '待复核领用', value: rows.value.filter((row) => row.status === '待复核').length },
  { label: '已归档同步', value: rows.value.filter((row) => row.status === '已归档').length },
  { label: '跌破报警线栏数', value: alarmCabinets.value.length },
])

function exportRows() {
  downloadEntries(MODULE_KEY)
}

function submitDispense() {
  errorMessage.value = ''
  noticeMessage.value = ''
  const result = registerDispense(form.value)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  noticeMessage.value = result.notice ? `${result.message}；${result.notice}` : result.message
  form.value = blankForm()
  showForm.value = false
  reload()
}

function runLedgerAction(action: string, entry: EntryRow) {
  errorMessage.value = ''
  noticeMessage.value = ''
  const result = advanceLedger(Number(entry.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  noticeMessage.value = result.message
  reload()
}

function reload() {
  rows.value = listRows(MODULE_KEY)
  reconcileRows.value = reconcileRemaining()
}

onMounted(reload)
</script>
