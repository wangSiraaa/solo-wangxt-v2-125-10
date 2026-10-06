/** 教学用离散色带（参考 ColorBrewer YlOrRd），按等值级分档。 */

const BANDS = [
  '#ffffcc',
  '#ffeda0',
  '#fed976',
  '#feb24c',
  '#fd8d3c',
  '#fc4e2a',
  '#e31a1c',
  '#b10026',
]

export function makeColorFor(levels: number[]): (v: number) => string {
  if (levels.length === 0) return () => withAlpha(BANDS[0])
  return (v: number) => {
    let i = 0
    while (i < levels.length && v > levels[i]) i++
    const idx = Math.min(i, BANDS.length - 1)
    return withAlpha(BANDS[idx])
  }
}

function withAlpha(hex: string, alpha = 0.62): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

export function legendStops(levels: number[]): { level: number; color: string }[] {
  return levels.map((level, i) => ({
    level,
    color: withAlpha(BANDS[Math.min(i, BANDS.length - 1)], 0.85),
  }))
}

/** 背景梯度色带（蓝色系，与烟羽 YlOrRd 明确区分）。 */
const BG_BANDS = [
  '#eff6ff',
  '#dbeafe',
  '#bfdbfe',
  '#93c5fd',
  '#60a5fa',
  '#3b82f6',
  '#2563eb',
  '#1e40af',
]

/** 背景值 → 颜色（按 [min, max] 线性分档；min==max 时取中间色）。 */
export function makeBgColorFor(min: number, max: number): (v: number) => string {
  const span = max - min
  return (v: number) => {
    const t = span > 0 ? (v - min) / span : 0.5
    const idx = Math.max(
      0,
      Math.min(BG_BANDS.length - 1, Math.floor(t * BG_BANDS.length)),
    )
    return withAlpha(BG_BANDS[idx], 0.5)
  }
}

/** 背景图层的数值图例刻度（含端点，升序）。 */
export function bgLegendStops(
  min: number,
  max: number,
  n = 5,
): { value: number; color: string }[] {
  const colorFor = makeBgColorFor(min, max)
  const out: { value: number; color: string }[] = []
  for (let i = 0; i < n; i += 1) {
    const v = min + ((max - min) * i) / (n - 1)
    out.push({ value: v, color: colorFor(v) })
  }
  return out
}
