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

/** 背景梯度专用色带（参考 ColorBrewer BuGn，蓝绿），与烟羽暖色明确区分。 */
const BG_BANDS = [
  '#f7fcfd',
  '#d0f1e8',
  '#a6ddcc',
  '#66c2a4',
  '#2ca28c',
  '#006d5b',
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

/** 线性背景：按 [min,max] 均分 n 档，返回色档下界与颜色（供背景图层/图例）。 */
export function bgColorStops(
  min: number,
  max: number,
  n = 6,
): { level: number; color: string }[] {
  const lo = Math.min(min, max)
  const hi = Math.max(min, max)
  if (!Number.isFinite(hi - lo) || hi - lo === 0) {
    return [{ level: lo, color: withAlpha(BG_BANDS[3], 0.55) }]
  }
  return Array.from({ length: n }, (_, i) => ({
    level: lo + ((hi - lo) * i) / (n - 1),
    color: withAlpha(BG_BANDS[i], 0.5),
  }))
}

export function bgColorFor(
  min: number,
  max: number,
): (v: number) => string {
  const stops = bgColorStops(min, max, BG_BANDS.length)
  const lo = Math.min(min, max)
  const span = Math.max(max, min) - lo || 1
  return (v: number) => {
    let i = Math.floor(((v - lo) / span) * (BG_BANDS.length - 1))
    i = Math.max(0, Math.min(BG_BANDS.length - 1, i))
    return stops[Math.min(i, stops.length - 1)].color
  }
}
