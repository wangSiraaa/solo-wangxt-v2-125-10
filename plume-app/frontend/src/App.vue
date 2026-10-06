<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import ControlPanel from './components/ControlPanel.vue'
import MapView from './components/MapView.vue'
import ResultPanel from './components/ResultPanel.vue'
import { api } from './api'
import {
  DEFAULT_FORM,
  gradientAllNonNegative,
  gradientBoundsValid,
  type FormState,
} from './form'
import type {
  MetRow,
  PlumeGridResponse,
  SourceRow,
} from './types'
import { bgColorStops, legendStops } from './colors'

const sources = ref<SourceRow[]>([])
const meteorology = ref<MetRow[]>([])
const form = ref<FormState>({ ...DEFAULT_FORM })
const result = ref<PlumeGridResponse | null>(null)
const error = ref<string | null>(null)
const loading = ref(false)
const repo = ref<string>('…')
const showFill = ref(true)
const showIso = ref(true)
const showBg = ref(true)

const isCalm = computed(() => form.value.windSpeed < form.value.calmThreshold)
const gradientInvalid = computed(
  () =>
    form.value.gradientEnabled &&
    (!gradientBoundsValid(form.value) ||
      !gradientAllNonNegative(form.value)),
)

onMounted(async () => {
  try {
    const [h, s, m] = await Promise.all([
      api.health(),
      api.sources(),
      api.meteorology(),
    ])
    repo.value = h.repository
    sources.value = s
    meteorology.value = m
    applySource(s[0])
    applyMet(m[0])
    await run()
  } catch (e: any) {
    error.value = '初始化失败：' + e.message
  }
})

function applySource(s: SourceRow) {
  form.value = {
    ...form.value,
    sourceId: s.id,
    stackHeight: s.stack_height_m,
    emission: s.emission_rate_g_s,
    stackDia: s.stack_diameter_m,
    exitV: s.exit_velocity_ms,
    stackT: s.stack_temp_k,
  }
}

function applyMet(m: MetRow) {
  form.value = {
    ...form.value,
    metId: m.id,
    windFrom: m.wind_from_deg,
    windSpeed: m.wind_speed_ms,
    stability: m.stability_class,
    ambientT: m.ambient_temp_k,
    pressure: m.pressure_hpa,
    background: m.background_conc_ug_m3,
  }
}

function onSelectSource(id: number) {
  const s = sources.value.find((x) => x.id === id)
  if (s) {
    applySource(s)
    run()
  }
}
function onSelectMet(id: number) {
  const m = meteorology.value.find((x) => x.id === id)
  if (m) {
    applyMet(m)
    run()
  }
}

async function run() {
  if (isCalm.value) {
    result.value = null
    error.value =
      `静风（u=${form.value.windSpeed} m/s < 阈值 ${form.value.calmThreshold} m/s）：` +
      '定常高斯烟羽输运假设失效，模型拒绝硬算，不输出任何浓度场。'
    return
  }
  if (form.value.gradientEnabled) {
    if (!gradientBoundsValid(form.value)) {
      result.value = null
      error.value =
        '背景梯度矩形无效：须满足 E_min < E_max 且 N_min < N_max。'
      return
    }
    if (!gradientAllNonNegative(form.value)) {
      result.value = null
      error.value =
        '背景梯度在矩形四角出现负值：背景浓度不得为负，请调小斜率或提高基准值。'
      return
    }
  }
  loading.value = true
  error.value = null
  const s = sources.value.find((x) => x.id === form.value.sourceId)!
  try {
    result.value = await api.plumeGrid({
      source: {
        name: s.name,
        lon: s.lon,
        lat: s.lat,
        stack_height_m: form.value.stackHeight,
        emission_rate_g_s: form.value.emission,
        stack_diameter_m: form.value.stackDia,
        exit_velocity_ms: form.value.exitV,
        stack_temp_k: form.value.stackT,
        pollutant: s.pollutant,
      },
      meteorology: {
        name: '界面情景',
        wind_from_deg: form.value.windFrom,
        wind_speed_ms: form.value.windSpeed,
        stability_class: form.value.stability,
        ambient_temp_k: form.value.ambientT,
        pressure_hpa: form.value.pressure,
        background_conc_ug_m3: form.value.background,
      },
      grid: {
        downwind_extent_m: form.value.downwindExtent,
        crosswind_extent_m: form.value.crosswindExtent,
        upwind_extent_m: form.value.upwindExtent,
        nx: form.value.nx,
        ny: form.value.ny,
      },
      plume_rise: { use_plume_rise: form.value.useRise },
      parameterization: form.value.parameterization,
      power_law:
        form.value.parameterization === 'power_law'
          ? { ay: form.value.ay, py: form.value.py, az: form.value.az, pz: form.value.pz }
          : null,
      calm_threshold_ms: form.value.calmThreshold,
      background_gradient: form.value.gradientEnabled
        ? {
            base_ug_m3: form.value.gradBase,
            // 界面斜率单位 μg/m³/km → 请求单位 μg/m³/m
            dcd_east_ug_m3_m: form.value.gradSlopeEast / 1000,
            dcd_north_ug_m3_m: form.value.gradSlopeNorth / 1000,
            e_min_m: form.value.gradEMin,
            e_max_m: form.value.gradEMax,
            n_min_m: form.value.gradNMin,
            n_max_m: form.value.gradNMax,
          }
        : null,
    })
  } catch (e: any) {
    result.value = null
    if (e.apiError?.error === 'calm_wind') {
      error.value = e.apiError.message
    } else {
      error.value = e.message || '计算失败'
    }
  } finally {
    loading.value = false
  }
}

const stops = computed(() =>
  result.value ? legendStops(result.value.iso_levels_ug_m3) : [],
)

const isGradient = computed(
  () => result.value?.background_info.mode === 'linear_rect',
)
const bgStops = computed(() => {
  const info = result.value?.background_info
  if (!result.value || info?.mode !== 'linear_rect') return []
  return bgColorStops(info.min_ug_m3 ?? 0, info.max_ug_m3 ?? 0)
})
const bgConstant = computed(() =>
  typeof result.value?.background_conc_ug_m3 === 'number'
    ? (result.value.background_conc_ug_m3 as number)
    : null,
)
const bgOutsideCells = computed(
  () =>
    (result.value?.diagnostics
      ?.n_background_outside_rect_cells as number | undefined) ?? 0,
)
</script>

<template>
  <div class="layout">
    <header class="topbar">
      <h1>离线高斯烟羽情景演示</h1>
      <span class="sub">平坦地形 · 稳态风 · 显式参数化 · 环境课程教学</span>
      <span class="spacer" />
      <span class="repo">数据后端：{{ repo === 'postgis' ? 'PostgreSQL/PostGIS' : '内存虚构数据（PostGIS 未连接时回退）' }}</span>
    </header>

    <ControlPanel
      :sources="sources"
      :meteorology="meteorology"
      v-model:form="form"
      :loading="loading"
      @select-source="onSelectSource"
      @select-met="onSelectMet"
      @run="run"
    />

    <div class="map-wrap">
      <MapView
        :result="result"
        :show-fill="showFill"
        :show-iso="showIso"
        :show-bg="showBg"
      />
      <div
        v-if="result && (stops.length || bgStops.length)"
        class="legend"
        style="left:12px;bottom:12px"
      >
        <template v-if="stops.length">
          <div>
            <b>烟羽贡献浓度</b>（μg/m³，不含背景）
          </div>
          <div class="bar">
            <span
              v-for="s in stops"
              :key="s.level"
              :style="{ flex: 1, background: s.color }"
            />
          </div>
          <div class="labels">
            <span>{{ stops[0].level }}</span>
            <span>{{ stops[stops.length - 1].level }}</span>
          </div>
        </template>
        <div v-else-if="isGradient">
          <b>烟羽贡献浓度</b>：全场为 0（本情景无烟羽分级）
        </div>
        <div v-if="isGradient && bgStops.length" style="margin-top:6px">
          <div>
            <b>背景梯度</b>（μg/m³，矩形内线性）
          </div>
          <div class="bar">
            <span
              v-for="s in bgStops"
              :key="s.level"
              :style="{ flex: 1, background: s.color }"
            />
          </div>
          <div class="labels">
            <span>{{ bgStops[0].level.toFixed(1) }}</span>
            <span>{{ bgStops[bgStops.length - 1].level.toFixed(1) }}</span>
          </div>
        </div>
        <div class="bgrow">
          <label class="toggle" style="margin:4px 0 2px">
            <input type="checkbox" v-model="showFill" /> 烟羽贡献等值区
          </label>
          <label class="toggle" style="margin:2px 0">
            <input type="checkbox" v-model="showIso" /> 烟羽贡献等值线
          </label>
          <label class="toggle" style="margin:2px 0">
            <input type="checkbox" v-model="showBg" />
            <template v-if="isGradient">
              背景梯度图层（{{ result.background_info.min_ug_m3?.toFixed(1) }}–{{
                result.background_info.max_ug_m3?.toFixed(1)
              }} μg/m³）
            </template>
            <template v-else>
              背景值叠加（均匀 {{ bgConstant }} μg/m³）
            </template>
          </label>
          <div class="muted" style="font-size:10px;margin-top:2px">
            总浓度＝烟羽贡献＋背景值，见右侧结果分解与悬停读数；
            图层开关仅改变显示，不改变后端返回的总量
          </div>
          <div
            v-if="isGradient && bgOutsideCells > 0"
            class="muted"
            style="font-size:10px;margin-top:2px;color:#0f766e"
          >
            实线蓝绿矩形＝背景梯度定义域；矩形外 {{ bgOutsideCells }} 个采样格
            背景/总量为 null（未定义，不外推）
          </div>
        </div>
      </div>
      <div v-if="isCalm" class="notice err" style="position:absolute;top:12px;left:50%;transform:translateX(-50%);z-index:6;max-width:560px">
        {{ error }}
      </div>
      <div class="disclaimer-foot">
        教学模型：不得用于真实事故预警或法规达标判定
      </div>
    </div>

    <ResultPanel :result="result" :error="error" />
  </div>
</template>
