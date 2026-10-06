export interface FormState {
  sourceId: number
  metId: number
  stackHeight: number
  emission: number
  stackDia: number
  exitV: number
  stackT: number
  windFrom: number
  windSpeed: number
  stability: 'A' | 'B' | 'C' | 'D' | 'E' | 'F'
  ambientT: number
  pressure: number
  background: number
  useRise: boolean
  parameterization: 'briggs_rural' | 'power_law'
  ay: number
  py: number
  az: number
  pz: number
  downwindExtent: number
  crosswindExtent: number
  upwindExtent: number
  nx: number
  ny: number
  calmThreshold: number
  // 单次情景的线性背景梯度（仅本次请求，不写回数据库）
  gradientEnabled: boolean
  gradBase: number
  // 斜率在界面上以 μg/m³/km 输入（更适合缓慢变化的演示），请求时换算为 /m
  gradSlopeEast: number
  gradSlopeNorth: number
  gradEMin: number
  gradEMax: number
  gradNMin: number
  gradNMax: number
}

export const DEFAULT_FORM: FormState = {
  sourceId: 1,
  metId: 1,
  stackHeight: 120,
  emission: 50,
  stackDia: 4,
  exitV: 18,
  stackT: 410,
  windFrom: 270,
  windSpeed: 6,
  stability: 'D',
  ambientT: 293.15,
  pressure: 1013,
  background: 15,
  useRise: false,
  parameterization: 'briggs_rural',
  ay: 0.22,
  py: 1,
  az: 0.16,
  pz: 1,
  downwindExtent: 6000,
  crosswindExtent: 2000,
  upwindExtent: 300,
  nx: 121,
  ny: 81,
  calmThreshold: 1,
  // 默认关闭：缺省情景继续使用空间常数背景
  gradientEnabled: false,
  gradBase: 15,
  // 缓慢东西梯度：每公里 +0.5 μg/m³（西低东高），可在界面调整
  gradSlopeEast: 0.5,
  gradSlopeNorth: 0,
  // 默认矩形覆盖默认采样网格（270° 西风下采样框的 E/N 包围盒）
  gradEMin: -300,
  gradEMax: 6000,
  gradNMin: -1000,
  gradNMax: 1000,
}

const R_EARTH = 6_371_000

/** 运输方位角（气象来向角 +180）。 */
export function transportBearingDeg(windFromDeg: number): number {
  return (windFromDeg + 180) % 360
}

/**
 * 按当前网格与风向计算采样矩形在局部 E/N（米）中的包围盒，
 * 与后端 build_sampling_grid 使用同一换算。用于“矩形取当前采样范围”。
 */
export function samplingBoundsEastNorth(
  f: Pick<
    FormState,
    | 'windFrom'
    | 'downwindExtent'
    | 'crosswindExtent'
    | 'upwindExtent'
  >,
): { eMin: number; eMax: number; nMin: number; nMax: number } {
  const xMin = -f.upwindExtent
  const xMax = f.downwindExtent
  const yMin = -f.crosswindExtent / 2
  const yMax = f.crosswindExtent / 2
  const theta = (transportBearingDeg(f.windFrom) * Math.PI) / 180
  const cornersEN = [
    [xMin, yMin],
    [xMin, yMax],
    [xMax, yMin],
    [xMax, yMax],
  ].map(([x, y]) => ({
    e: x * Math.sin(theta) + y * Math.cos(theta),
    n: x * Math.cos(theta) - y * Math.sin(theta),
  }))
  const es = cornersEN.map((c) => c.e)
  const ns = cornersEN.map((c) => c.n)
  return {
    eMin: Math.min(...es),
    eMax: Math.max(...es),
    nMin: Math.min(...ns),
    nMax: Math.max(...ns),
  }
}

/** 经纬度 -> 以源为原点的 E/N（米），等距圆柱近似（与后端一致）。 */
export function lonlatToEastNorth(
  lon: number,
  lat: number,
  lon0: number,
  lat0: number,
): { e: number; n: number } {
  const e =
    ((lon - lon0) * Math.PI) / 180 * R_EARTH * Math.cos((lat0 * Math.PI) / 180)
  const n = ((lat - lat0) * Math.PI) / 180 * R_EARTH
  return { e, n }
}

/** 矩形四角背景值（线性函数极值在角点）；用于非负校验与图例。 */
export function gradientCorners(
  f: Pick<
    FormState,
    | 'gradBase'
    | 'gradSlopeEast'
    | 'gradSlopeNorth'
    | 'gradEMin'
    | 'gradEMax'
    | 'gradNMin'
    | 'gradNMax'
  >,
): Record<'sw' | 'se' | 'ne' | 'nw', number> {
  const de = f.gradSlopeEast / 1000
  const dn = f.gradSlopeNorth / 1000
  const v = (e: number, n: number) => f.gradBase + de * e + dn * n
  return {
    sw: v(f.gradEMin, f.gradNMin),
    se: v(f.gradEMax, f.gradNMin),
    ne: v(f.gradEMax, f.gradNMax),
    nw: v(f.gradEMin, f.gradNMax),
  }
}

export function gradientBoundsValid(f: FormState): boolean {
  return f.gradEMax > f.gradEMin && f.gradNMax > f.gradNMin
}

/** 负背景（含角点）不允许提交，与后端 PlumeInputError 校验一致。 */
export function gradientAllNonNegative(f: FormState): boolean {
  const c = gradientCorners(f)
  return f.gradBase >= 0 && Math.min(c.sw, c.se, c.ne, c.nw) >= -1e-9
}
