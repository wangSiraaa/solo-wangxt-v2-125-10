/** 背景梯度特性的界面级冒烟：启用梯度 → 图层/图例/分解 → 矩形越界报错。 */
import { chromium } from 'playwright'

const errors: string[] = []
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('console: ' + m.text())
})
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))

await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' })
await page.waitForTimeout(2500)

// 0. 默认情景：常数背景（无梯度矩形、背景层为均匀单层）
const before = await page.evaluate(() => {
  const map = (window as any).__map
  return {
    bgrect: (map.getSource('bgrect')._data?.features || []).length,
    bgval: (map.getSource('bgval')._data?.features || []).length,
  }
})
console.log('默认(常数): bgrect features =', before.bgrect, ', bgval features =', before.bgval)
const bgLabel0 = await page.locator('.legend .bgrow .toggle').nth(2).textContent()
console.log('默认背景开关文案:', bgLabel0?.trim().slice(0, 40))

// 1. 启用背景梯度（东向 1.5 μg/m³/km）
await page.locator('details.params summary').nth(1).click() // 展开“背景空间梯度”
await page.locator('[data-test=bg-gradient]').check()
await page.locator('[data-test=bg-slope-east]').fill('1.5')

// 2. 统计 /api/plume/grid 请求次数，用于验证“关图层不重算”
let gridCalls = 0
page.on('request', (r) => {
  if (r.url().includes('/api/plume/grid')) gridCalls += 1
})
await page.getByRole('button', { name: '运行烟羽计算' }).click()
await page.waitForTimeout(2000)
console.log('运行后 grid 请求数:', gridCalls)

const grad = await page.evaluate(() => {
  const map = (window as any).__map
  return {
    bgrect: (map.getSource('bgrect')._data?.features || []).length,
    bgval: (map.getSource('bgval')._data?.features || []).length,
  }
})
console.log('梯度模式: bgrect features =', grad.bgrect, ', bgval 填色格数 =', grad.bgval)

// 3. 图例与结果分解
const legendText = await page.locator('.legend .bgrow').textContent()
console.log('图例含梯度公式:', legendText?.includes('/km·E'))
const panelText = await page.locator('.panel.right').textContent()
console.log('结果分解含“背景（线性梯度）”:', panelText?.includes('背景（线性梯度）'))
console.log('结果分解含矩形范围提示:', panelText?.includes('矩形外不计算、不外推'))

// 4. 关闭烟羽等值区/等值线图层：不得触发新的后端请求，总量显示不变
const totalSel = page.locator(
  'xpath=//dt[contains(text(),"总浓度")]/following-sibling::dd[1]',
)
const totalBefore = await totalSel.textContent()
const toggles = page.locator('.legend .bgrow .toggle input')
await toggles.nth(0).uncheck() // 烟羽贡献等值区
await toggles.nth(1).uncheck() // 烟羽贡献等值线
await page.waitForTimeout(800)
const totalAfter = await totalSel.textContent()
console.log('关图层后 grid 请求数(应仍为1):', gridCalls, '| 总量显示不变:', totalBefore === totalAfter, `(${totalAfter?.trim()})`)
await toggles.nth(0).check()
await toggles.nth(1).check()

// 5. 背景矩形不覆盖网格 → 明确报错（不外推）
await page.locator('.row2 label:has-text("矩形东界") input').fill('1000')
await page.getByRole('button', { name: '运行烟羽计算' }).click()
await page.waitForTimeout(1500)
const errText = await page.locator('.panel.right .notice.err').textContent()
console.log('越界报错含“外推”:', errText?.includes('外推'), '|', errText?.trim().slice(0, 50), '...')

// 6. 恢复矩形 + 斜率归零 → 与常数一致的提示路径（零梯度合法运行）
await page.locator('.row2 label:has-text("矩形东界") input').fill('10000')
await page.locator('[data-test=bg-slope-east]').fill('0')
await page.getByRole('button', { name: '运行烟羽计算' }).click()
await page.waitForTimeout(1500)
const minmax = await page.locator('.panel.right dl.kv dd').nth(1).textContent()
console.log('零梯度背景 min–max(应相等):', minmax?.trim().slice(0, 30))

console.log('console errors:', errors.length ? errors : '无')
await browser.close()
