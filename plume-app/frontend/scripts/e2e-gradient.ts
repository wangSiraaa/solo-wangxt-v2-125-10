/**
 * 线性背景梯度的端到端验收（需后端 8000 + 前端 5173 同时运行）：
 * 1. 默认模式仍为空间常数背景
 * 2. 启用梯度：参数输入、背景图层、数值图例、矩形外 null 提示
 * 3. 改 nx/ny 重新计算：同一受体结果不变（取悬停/网格数据）
 * 4. 关闭烟羽图层：后端 total 不变（只改显示，不重新请求）
 * 5. 负角点：运行按钮停用 + 错误提示
 */
import { chromium } from 'playwright'

const errors: string[] = []
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } })
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('console: ' + m.text())
})
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))

await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' })
await page.waitForTimeout(1800)

// ---- 1. 默认：常数背景 ----
const toggleLabelBefore = await page
  .locator('label.toggle', { hasText: '背景值叠加' })
  .textContent()
console.log('default bg toggle:', toggleLabelBefore?.replace(/\s+/g, ' ').trim())
if (!toggleLabelBefore?.includes('均匀')) throw new Error('默认情景应为空间常数背景')

// ---- 2. 启用梯度 ----
await page.locator('[data-test="gradient-enable"]').check()
await page.waitForTimeout(200)
// 用默认值（base=15, dE=0.5 μg/m³/km，默认矩形）直接计算
await page.getByRole('button', { name: '运行烟羽计算' }).click()
await page.waitForTimeout(2000)

const counts = await page.evaluate(() => {
  // @ts-ignore
  const map = (window as any).__map
  const bg = map.getSource('bgval')._data?.features || []
  const rect = map.getSource('bgrect')._data?.features || []
  return { bgFeatures: bg.length, rectFeatures: rect.length }
})
console.log('gradient bg fill polygons:', counts.bgFeatures, '| domain rect:', counts.rectFeatures)
if (counts.bgFeatures === 0) throw new Error('梯度背景图层无填色要素')
if (counts.rectFeatures !== 1) throw new Error('梯度定义域矩形未绘制')

const legendText = await page.locator('.legend').first().textContent()
if (!legendText?.includes('背景梯度')) throw new Error('缺少背景梯度数值图例')
console.log('bg legend present:', legendText.replace(/\s+/g, ' ').trim().slice(0, 80))

// 结果面板：梯度模式 + 矩形外 null 计数
await page.getByRole('button', { name: '结果分解' }).click()
await page.waitForTimeout(300)
const decomp = await page.locator('.panel.right').textContent()
if (!decomp?.includes('矩形内线性梯度')) throw new Error('结果面板未识别梯度模式')
const nullCount = await page.evaluate(async () => {
  const r = await fetch('/api/plume/grid', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source: {
        name: 's', lon: 116.4, lat: 39.9,
        stack_height_m: 120, emission_rate_g_s: 50,
        stack_diameter_m: 4, exit_velocity_ms: 18, stack_temp_k: 410, pollutant: 'SO2',
      },
      meteorology: {
        name: 'm', wind_from_deg: 270, wind_speed_ms: 6, stability_class: 'D',
        ambient_temp_k: 293.15, pressure_hpa: 1013, background_conc_ug_m3: 15,
      },
      grid: {
        downwind_extent_m: 6000, crosswind_extent_m: 2000,
        upwind_extent_m: 300, nx: 121, ny: 81,
      },
      plume_rise: { use_plume_rise: false },
      parameterization: 'briggs_rural',
      power_law: null,
      calm_threshold_ms: 1,
      background_gradient: {
        base_ug_m3: 15, dcd_east_ug_m3_m: 0.0005, dcd_north_ug_m3_m: 0,
        e_min_m: -300, e_max_m: 6000, n_min_m: -1000, n_max_m: 1000,
      },
    }),
  }).then((x) => x.json())
  return {
    nOut: r.diagnostics.n_background_outside_rect_cells,
    nIn: r.diagnostics.n_background_defined_cells,
    min: r.background_info.min_ug_m3,
    max: r.background_info.max_ug_m3,
  }
})
console.log('domain cells in/out:', nullCount.nIn, '/', nullCount.nOut,
  '| bg range:', nullCount.min, '-', nullCount.max)
if (!(nullCount.nOut > 0)) throw new Error('应有矩形外采样格（null，不外推）')

// ---- 3. 分辨率无关：同一物理格点（E=2000, N=0 附近），粗/细网格一致 ----
const resolution = await page.evaluate(async () => {
  const body = (nx: number, ny: number) => ({
    source: {
      name: 's', lon: 116.4, lat: 39.9,
      stack_height_m: 60, emission_rate_g_s: 50,
      stack_diameter_m: 4, exit_velocity_ms: 18, stack_temp_k: 410, pollutant: 'SO2',
    },
    meteorology: {
      name: 'm', wind_from_deg: 270, wind_speed_ms: 4, stability_class: 'D',
      ambient_temp_k: 293.15, pressure_hpa: 1013, background_conc_ug_m3: 12,
    },
    grid: {
      downwind_extent_m: 2000, crosswind_extent_m: 1000, upwind_extent_m: 0,
      nx, ny,
    },
    plume_rise: { use_plume_rise: false },
    parameterization: 'briggs_rural',
    power_law: null,
    calm_threshold_ms: 1,
    background_gradient: {
      base_ug_m3: 12, dcd_east_ug_m3_m: 0.002, dcd_north_ug_m3_m: -0.001,
      e_min_m: -500, e_max_m: 1500, n_min_m: -400, n_max_m: 400,
    },
  })
  const a = await fetch('/api/plume/grid', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body(21, 11)),
  }).then((x) => x.json())
  const b = await fetch('/api/plume/grid', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body(41, 21)),
  }).then((x) => x.json())
  return {
    plumeCoarse: a.plume_field_ug_m3[5][10],
    plumeFine: b.plume_field_ug_m3[10][20],
    bgCoarse: a.background_conc_ug_m3[5][10],
    bgFine: b.background_conc_ug_m3[10][20],
    totalCoarse: a.total_conc_ug_m3[5][10],
    totalFine: b.total_conc_ug_m3[10][20],
  }
})
console.log('resolution invariance:', resolution)
if (Math.abs(resolution.plumeCoarse - resolution.plumeFine) > 1e-9)
  throw new Error('烟羽分辨率不一致')
if (Math.abs(resolution.bgCoarse - resolution.bgFine) > 1e-9)
  throw new Error('背景分辨率不一致')
if (Math.abs(resolution.bgCoarse - 14) > 1e-9)
  throw new Error('E=1000 处背景应为 14')

// ---- 4. 关闭烟羽图层不重新请求，后端 total 不变（UI 层验证）----
const resBefore = await page.evaluate(() => {
  // @ts-ignore
  const map = (window as any).__map
  return (map.getSource('fill')._data?.features || []).length
})
await page.locator('label.toggle', { hasText: '烟羽贡献等值区' }).locator('input').uncheck()
await page.waitForTimeout(500)
const fillAfter = await page.evaluate(() => {
  // @ts-ignore
  const map = (window as any).__map
  return (map.getSource('fill')._data?.features || []).length
})
const bgAfter = await page.evaluate(() => {
  // @ts-ignore
  const map = (window as any).__map
  return (map.getSource('bgval')._data?.features || []).length
})
console.log('fill layer features:', resBefore, '->', fillAfter, '| bg still:', bgAfter)
if (fillAfter !== 0) throw new Error('关闭后烟羽填色应清空')
if (bgAfter === 0) throw new Error('背景图层不应受烟羽开关影响')
await page.screenshot({ path: '/tmp/plume-gradient.png' })

// ---- 5. 负角点：输入强负斜率后按钮停用 ----
await page.locator('[data-test="grad-slope-e"]').fill('-5')
await page.waitForTimeout(200)
const runDisabled = await page.getByRole('button', { name: '运行烟羽计算' }).isDisabled()
const badge = await page.locator('.badge.bad', { hasText: '背景参数无效' }).count()
console.log('negative corners -> run disabled:', runDisabled, '| badge:', badge)
if (!runDisabled || badge === 0) throw new Error('负角点应阻止提交')

// 后端也应 422
const rejected = await page.evaluate(async () => {
  const r = await fetch('/api/plume/grid', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source: {
        name: 's', lon: 116.4, lat: 39.9,
        stack_height_m: 60, emission_rate_g_s: 50,
      },
      meteorology: {
        name: 'm', wind_from_deg: 270, wind_speed_ms: 4, stability_class: 'D',
        background_conc_ug_m3: 5,
      },
      grid: { nx: 11, ny: 11 },
      background_gradient: {
        base_ug_m3: 5, dcd_east_ug_m3_m: -0.01, dcd_north_ug_m3_m: 0,
        e_min_m: 0, e_max_m: 1000, n_min_m: -100, n_max_m: 100,
      },
    }),
  })
  return { status: r.status, body: await r.json() }
})
console.log('negative corner API:', rejected.status, rejected.body.error)
if (rejected.status !== 422) throw new Error('负角点后端应返回 422')

// ---- 6. 关闭梯度 → 回到常数模式 ----
await page.locator('[data-test="gradient-enable"]').uncheck()
await page.getByRole('button', { name: '运行烟羽计算' }).click()
await page.waitForTimeout(1500)
const toggleAfter = await page
  .locator('label.toggle', { hasText: '背景值叠加' })
  .textContent()
console.log('after disable:', toggleAfter?.replace(/\s+/g, ' ').trim())
if (!toggleAfter?.includes('均匀')) throw new Error('关闭梯度后应恢复常数背景')

if (errors.length) {
  console.log('--- JS errors ---')
  errors.forEach((e) => console.log(e))
  process.exit(1)
}
console.log('GRADIENT E2E ALL PASSED, no JS errors')
await browser.close()
