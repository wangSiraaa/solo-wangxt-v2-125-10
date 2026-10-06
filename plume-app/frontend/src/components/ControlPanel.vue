<script setup lang="ts">
import { computed } from 'vue'
import type { MetRow, SourceRow } from '../types'
import {
  gradientAllNonNegative,
  gradientBoundsValid,
  gradientCorners,
  samplingBoundsEastNorth,
  type FormState,
} from '../form'

const props = defineProps<{
  sources: SourceRow[]
  meteorology: MetRow[]
  form: FormState
  loading: boolean
}>()

const emit = defineEmits<{
  (e: 'update:form', v: FormState): void
  (e: 'select-source', id: number): void
  (e: 'select-met', id: number): void
  (e: 'run'): void
}>()

function patch(p: Partial<FormState>) {
  emit('update:form', { ...props.form, ...p })
}

const isCalm = computed(() => props.form.windSpeed < props.form.calmThreshold)

const corners = computed(() => gradientCorners(props.form))
const boundsOk = computed(() => gradientBoundsValid(props.form))
const nonNeg = computed(() => gradientAllNonNegative(props.form))
const gradientBlocked = computed(() => !boundsOk.value || !nonNeg.value)

function useSamplingBounds() {
  const b = samplingBoundsEastNorth(props.form)
  // 向外留 10 m 余量，避免边界采样点因浮点误差落到矩形外
  patch({
    gradEMin: Math.floor(b.eMin - 10),
    gradEMax: Math.ceil(b.eMax + 10),
    gradNMin: Math.floor(b.nMin - 10),
    gradNMax: Math.ceil(b.nMax + 10),
  })
}

function enableGradient(on: boolean) {
  if (on) {
    // 首次开启：基准取当前常数背景，并把矩形预填为当前采样范围
    const b = samplingBoundsEastNorth(props.form)
    patch({
      gradientEnabled: true,
      gradBase: props.form.background,
      gradEMin: props.form.gradEMax > props.form.gradEMin
        ? props.form.gradEMin
        : Math.floor(b.eMin - 10),
      gradEMax: props.form.gradEMax > props.form.gradEMin
        ? props.form.gradEMax
        : Math.ceil(b.eMax + 10),
      gradNMin: props.form.gradNMax > props.form.gradNMin
        ? props.form.gradNMin
        : Math.floor(b.nMin - 10),
      gradNMax: props.form.gradNMax > props.form.gradNMin
        ? props.form.gradNMax
        : Math.ceil(b.nMax + 10),
    })
  } else {
    patch({ gradientEnabled: false })
  }
}
</script>

<template>
  <div class="panel">
    <div class="section">
      <h2>虚构情景（教学数据，非真实设施）</h2>
      <label class="field">
        <span class="lbl">排放源</span>
        <select
          class="num"
          :value="form.sourceId"
          @change="emit('select-source', Number(($event.target as HTMLSelectElement).value))"
        >
          <option v-for="s in sources" :key="s.id" :value="s.id">
            {{ s.name }}（{{ s.pollutant }}，H={{ s.stack_height_m }} m）
          </option>
        </select>
      </label>
      <label class="field">
        <span class="lbl">气象情景</span>
        <select
          class="num"
          :value="form.metId"
          @change="emit('select-met', Number(($event.target as HTMLSelectElement).value))"
        >
          <option v-for="m in meteorology" :key="m.id" :value="m.id">
            {{ m.name }}
          </option>
        </select>
      </label>
      <div class="muted" style="font-size:11px">
        下列调整只用于本次计算请求，不会写回数据库记录。
      </div>
    </div>

    <div class="section">
      <h2>① 源项</h2>
      <label class="field">
        <span class="lbl">烟囱高度 H（m）<b>{{ form.stackHeight }}</b></span>
        <input data-test="height" type="range" min="5" max="250" step="1" :value="form.stackHeight"
          @input="patch({ stackHeight: Number(($event.target as HTMLInputElement).value) })" />
      </label>
      <label class="field">
        <span class="lbl">排放率 Q（g/s）<b>{{ form.emission }}</b></span>
        <input data-test="emission" type="range" min="0" max="200" step="0.5" :value="form.emission"
          @input="patch({ emission: Number(($event.target as HTMLInputElement).value) })" />
      </label>
      <details class="params">
        <summary>抬升参数（Holland，默认关闭）</summary>
        <div class="toggle">
          <input type="checkbox" :checked="form.useRise"
            @change="patch({ useRise: ($event.target as HTMLInputElement).checked })" />
          叠加烟气抬升 Δh
        </div>
        <div class="row2">
          <label class="field"><span class="lbl">出口内径 d（m）</span>
            <input class="num" type="number" step="0.1" :value="form.stackDia"
              @input="patch({ stackDia: Number(($event.target as HTMLInputElement).value) })" /></label>
          <label class="field"><span class="lbl">出口流速（m/s）</span>
            <input class="num" type="number" step="0.5" :value="form.exitV"
              @input="patch({ exitV: Number(($event.target as HTMLInputElement).value) })" /></label>
          <label class="field"><span class="lbl">烟气温度（K）</span>
            <input class="num" type="number" step="1" :value="form.stackT"
              @input="patch({ stackT: Number(($event.target as HTMLInputElement).value) })" /></label>
        </div>
      </details>
    </div>

    <div class="section">
      <h2>② 气象（稳态风）</h2>
      <label class="field">
        <span class="lbl">风速 u（m/s）<b>{{ form.windSpeed }}</b></span>
        <input data-test="windspeed" type="range" min="0" max="12" step="0.1" :value="form.windSpeed"
          @input="patch({ windSpeed: Number(($event.target as HTMLInputElement).value) })" />
      </label>
      <div v-if="isCalm" class="notice err">
        静风：u={{ form.windSpeed }} m/s &lt; 阈值 {{ form.calmThreshold }} m/s。
        定常高斯烟羽不适用，模型将<b>拒绝计算</b>（不用近零风速除出巨大浓度）。
      </div>
      <label class="field">
        <span class="lbl">
          风向（气象来向角，0=北来风，顺时针）<b>{{ form.windFrom }}°</b>
        </span>
        <input data-test="windfrom" type="range" min="0" max="359" step="1" :value="form.windFrom"
          @input="patch({ windFrom: Number(($event.target as HTMLInputElement).value) })" />
      </label>
      <label class="field">
        <span class="lbl">Pasquill 稳定度</span>
        <select class="num" :value="form.stability"
          @change="patch({ stability: ($event.target as HTMLSelectElement).value as FormState['stability'] })">
          <option value="A">A 极不稳定</option>
          <option value="B">B 不稳定</option>
          <option value="C">C 弱不稳定</option>
          <option value="D">D 中性</option>
          <option value="E">E 较稳定</option>
          <option value="F">F 稳定</option>
        </select>
      </label>
      <div class="row2">
        <label class="field"><span class="lbl">环境温度（K）</span>
          <input class="num" type="number" step="0.1" :value="form.ambientT"
            @input="patch({ ambientT: Number(($event.target as HTMLInputElement).value) })" /></label>
        <label class="field"><span class="lbl">气压（hPa）</span>
          <input class="num" type="number" step="1" :value="form.pressure"
            @input="patch({ pressure: Number(($event.target as HTMLInputElement).value) })" /></label>
      </div>
      <label class="field">
        <span class="lbl">
          背景浓度（μg/m³，与烟羽分开计量）<b>{{ form.background }}</b>
          <em v-if="form.gradientEnabled" class="muted" style="font-style:normal;font-size:10px">
            梯度模式下以“基准 base”输入项为准
          </em>
        </span>
        <input data-test="background" type="range" min="0" max="100" step="0.5" :value="form.background"
          @input="patch({ background: Number(($event.target as HTMLInputElement).value) })" />
      </label>

      <details class="params" :open="form.gradientEnabled" data-test="gradient-section">
        <summary>
          线性背景梯度（单次情景；默认关闭＝空间常数背景）
        </summary>
        <div class="toggle">
          <input type="checkbox" :checked="form.gradientEnabled" data-test="gradient-enable"
            @change="enableGradient(($event.target as HTMLInputElement).checked)" />
          启用有限矩形内线性背景 C_bg(E,N)=base+dC/dE·E+dC/dN·N
        </div>
        <div v-if="form.gradientEnabled" class="muted" style="font-size:11px;margin:4px 0">
          E/N 为<b>以排放源为原点</b>的局部东/北坐标（米），网格与任意受体点用同一换算；
          矩形<b>外不外推</b>（背景/总量返回 null）。只作用于本次请求。
        </div>
        <div v-if="form.gradientEnabled" class="row2">
          <label class="field"><span class="lbl">基准 base（源点，μg/m³）</span>
            <input class="num" type="number" min="0" step="0.5" data-test="grad-base"
              :value="form.gradBase"
              @input="patch({ gradBase: Number(($event.target as HTMLInputElement).value) })" /></label>
          <label class="field"><span class="lbl">东西斜率 dC/dE（μg/m³/km，东为正）</span>
            <input class="num" type="number" step="0.05" data-test="grad-slope-e"
              :value="form.gradSlopeEast"
              @input="patch({ gradSlopeEast: Number(($event.target as HTMLInputElement).value) })" /></label>
          <label class="field"><span class="lbl">南北斜率 dC/dN（μg/m³/km，北为正）</span>
            <input class="num" type="number" step="0.05" data-test="grad-slope-n"
              :value="form.gradSlopeNorth"
              @input="patch({ gradSlopeNorth: Number(($event.target as HTMLInputElement).value) })" /></label>
        </div>
        <div v-if="form.gradientEnabled">
          <div class="row2">
            <label class="field"><span class="lbl">矩形 E 西界（m）</span>
              <input class="num" type="number" step="10" data-test="grad-emin"
                :value="form.gradEMin"
                @input="patch({ gradEMin: Number(($event.target as HTMLInputElement).value) })" /></label>
            <label class="field"><span class="lbl">矩形 E 东界（m）</span>
              <input class="num" type="number" step="10" data-test="grad-emax"
                :value="form.gradEMax"
                @input="patch({ gradEMax: Number(($event.target as HTMLInputElement).value) })" /></label>
            <label class="field"><span class="lbl">矩形 N 南界（m）</span>
              <input class="num" type="number" step="10" data-test="grad-nmin"
                :value="form.gradNMin"
                @input="patch({ gradNMin: Number(($event.target as HTMLInputElement).value) })" /></label>
            <label class="field"><span class="lbl">矩形 N 北界（m）</span>
              <input class="num" type="number" step="10" data-test="grad-nmax"
                :value="form.gradNMax"
                @input="patch({ gradNMax: Number(($event.target as HTMLInputElement).value) })" /></label>
          </div>
          <button type="button" class="ghost" style="margin:2px 0"
            data-test="grad-fit-sampling" @click="useSamplingBounds">
            矩形取当前采样范围（随风向旋转后的 E/N 包围盒）
          </button>
          <table class="meta-tbl" style="margin-top:4px">
            <tr><th>矩形四角背景</th><th>SW</th><th>SE</th><th>NE</th><th>NW</th></tr>
            <tr>
              <td>μg/m³</td>
              <td :class="{ badv: corners.sw < 0 }">{{ corners.sw.toFixed(2) }}</td>
              <td :class="{ badv: corners.se < 0 }">{{ corners.se.toFixed(2) }}</td>
              <td :class="{ badv: corners.ne < 0 }">{{ corners.ne.toFixed(2) }}</td>
              <td :class="{ badv: corners.nw < 0 }">{{ corners.nw.toFixed(2) }}</td>
            </tr>
          </table>
          <div v-if="!boundsOk" class="notice err" style="margin-top:4px">
            矩形边界无效：须 E_min &lt; E_max 且 N_min &lt; N_max。
          </div>
          <div v-else-if="!nonNeg" class="notice err" style="margin-top:4px">
            矩形四角出现负背景：不允许提交（后端同样会 422 拒绝，不截断、不外推）。
          </div>
          <div v-else class="notice info" style="margin-top:4px">
            四角均非负；矩形内背景介于
            {{ Math.min(corners.sw, corners.se, corners.ne, corners.nw).toFixed(2) }}–{{
              Math.max(corners.sw, corners.se, corners.ne, corners.nw).toFixed(2)
            }} μg/m³。
          </div>
        </div>
      </details>
    </div>

    <div class="section">
      <h2>③ 弥散参数化（显式系数）</h2>
      <label class="field">
        <select class="num" :value="form.parameterization"
          @change="patch({ parameterization: ($event.target as HTMLSelectElement).value as any })">
          <option value="briggs_rural">Briggs 乡村系数（默认，建议 0.1–10 km）</option>
          <option value="power_law">幂律 σ=a·x^p（解析核对用）</option>
        </select>
      </label>
      <details v-if="form.parameterization === 'power_law'" class="params">
        <summary>幂律系数</summary>
        <div class="row2">
          <label class="field"><span class="lbl">ay</span>
            <input class="num" type="number" step="0.01" :value="form.ay"
              @input="patch({ ay: Number(($event.target as HTMLInputElement).value) })" /></label>
          <label class="field"><span class="lbl">py</span>
            <input class="num" type="number" step="0.1" :value="form.py"
              @input="patch({ py: Number(($event.target as HTMLInputElement).value) })" /></label>
          <label class="field"><span class="lbl">az</span>
            <input class="num" type="number" step="0.01" :value="form.az"
              @input="patch({ az: Number(($event.target as HTMLInputElement).value) })" /></label>
          <label class="field"><span class="lbl">pz</span>
            <input class="num" type="number" step="0.1" :value="form.pz"
              @input="patch({ pz: Number(($event.target as HTMLInputElement).value) })" /></label>
        </div>
      </details>
    </div>

    <div class="section">
      <h2>④ 采样网格（只改变采样，不改变输入）</h2>
      <div class="row2">
        <label class="field"><span class="lbl">下风向范围（m）</span>
          <input class="num" type="number" step="100" :value="form.downwindExtent"
            @input="patch({ downwindExtent: Number(($event.target as HTMLInputElement).value) })" /></label>
        <label class="field"><span class="lbl">横风向范围（m）</span>
          <input class="num" type="number" step="100" :value="form.crosswindExtent"
            @input="patch({ crosswindExtent: Number(($event.target as HTMLInputElement).value) })" /></label>
        <label class="field"><span class="lbl">上风向延伸（m）</span>
          <input class="num" type="number" step="50" :value="form.upwindExtent"
            @input="patch({ upwindExtent: Number(($event.target as HTMLInputElement).value) })" /></label>
      </div>
      <label class="field">
        <span class="lbl">下风向格点数 nx <b>{{ form.nx }}</b></span>
        <input data-test="nx" type="range" min="21" max="201" step="10" :value="form.nx"
          @input="patch({ nx: Number(($event.target as HTMLInputElement).value) })" />
      </label>
      <label class="field">
        <span class="lbl">横风向格点数 ny <b>{{ form.ny }}</b></span>
        <input data-test="ny" type="range" min="11" max="121" step="2" :value="form.ny"
          @input="patch({ ny: Number(($event.target as HTMLInputElement).value) })" />
      </label>
      <label class="field"><span class="lbl">静风阈值（m/s）</span>
        <input class="num" type="number" min="0.1" max="5" step="0.1" :value="form.calmThreshold"
          @input="patch({ calmThreshold: Number(($event.target as HTMLInputElement).value) })" /></label>
      <button @click="emit('run')" :disabled="loading || isCalm || (form.gradientEnabled && gradientBlocked)">
        {{ loading ? '计算中…' : '运行烟羽计算' }}
      </button>
      <span v-if="isCalm" class="badge bad">静风，已停用</span>
      <span v-else-if="form.gradientEnabled && gradientBlocked" class="badge bad">
        背景参数无效
      </span>
    </div>
  </div>
</template>
