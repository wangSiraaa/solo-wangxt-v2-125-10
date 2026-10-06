<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import maplibregl from 'maplibre-gl'
import type { PlumeGridResponse } from '../types'
import {
  gridFillPolygons,
  gridNullableFillPolygons,
  marchingSquares,
  rectBoundary,
  samplingBoundary,
} from '../marching'
import { bgColorFor, makeColorFor } from '../colors'

const props = defineProps<{
  result: PlumeGridResponse | null
  showFill: boolean
  showIso: boolean
  showBg: boolean
}>()

const hover = ref<{
  lon: number
  lat: number
  plume: number
  total: number | null
  bg: number | null
  inDomain: boolean
  xm: number
  ym: number
} | null>(null)

let map: maplibregl.Map | null = null
let sourceMarker: maplibregl.Marker | null = null
let rafPending = false

const R = 6371000

function bgScalarAt(r: PlumeGridResponse, row: number, col: number): number | null {
  const bg = r.background_conc_ug_m3
  return typeof bg === 'number' ? bg : bg[row]?.[col] ?? null
}

function blankStyle(): maplibregl.StyleSpecification {
  const style: any = {
    version: 8,
    sources: {},
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#e9eef2' } },
    ],
  }
  // 离线环境可通过 VITE_TILE_URL 指向本地瓦片服务
  const tileUrl = (import.meta as any).env?.VITE_TILE_URL as
    | string
    | undefined
  if (tileUrl) {
    style.sources.tiles = {
      type: 'raster',
      tiles: [tileUrl],
      tileSize: 256,
      attribution: '本地离线瓦片',
    }
    style.layers.push({ id: 'tiles', type: 'raster', source: 'tiles' })
  }
  return style as maplibregl.StyleSpecification
}

onMounted(() => {
  map = new maplibregl.Map({
    container: 'map',
    style: blankStyle(),
    center: [116.4, 39.9],
    zoom: 3,
    attributionControl: false,
  })
  map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'top-left')
  map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left')
  ;(window as any).__map = map

  map.on('load', () => {
    // 背景值源/层最先加入（渲染在烟羽之下）
    map!.addSource('bgval', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    map!.addLayer({
      id: 'bgval-layer',
      type: 'fill',
      source: 'bgval',
      layout: { visibility: 'none' },
      paint: {
        'fill-color': ['get', 'color'],
        'fill-opacity': 0.16,
      },
    })
    // 背景梯度定义域矩形（实线蓝绿，区别于虚线采样边界）
    map!.addSource('bgrect', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    map!.addLayer({
      id: 'bgrect-line',
      type: 'line',
      source: 'bgrect',
      layout: { visibility: 'none' },
      paint: { 'line-color': '#0f766e', 'line-width': 1.8 },
    })
    map!.addSource('fill', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    map!.addLayer({
      id: 'fill-layer',
      type: 'fill',
      source: 'fill',
      paint: { 'fill-color': ['get', 'color'], 'fill-antialias': false },
    })
    map!.addSource('iso', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    map!.addLayer({
      id: 'iso-layer',
      type: 'line',
      source: 'iso',
      paint: {
        'line-color': '#5b21b6',
        'line-width': ['interpolate', ['linear'], ['get', 'level'],
          0.001, 0.6, 1000, 2.4],
        'line-opacity': 0.85,
      },
    })
    map!.addSource('boundary', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    map!.addLayer({
      id: 'boundary-fill',
      type: 'fill',
      source: 'boundary',
      paint: { 'fill-color': '#000', 'fill-opacity': 0 },
    })
    map!.addLayer({
      id: 'boundary-line',
      type: 'line',
      source: 'boundary',
      paint: { 'line-color': '#334155', 'line-width': 1.4, 'line-dasharray': [3, 2] },
    })
    map!.addSource('wind', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    map!.addLayer({
      id: 'wind-arrow',
      type: 'line',
      source: 'wind',
      paint: { 'line-color': '#0f766e', 'line-width': 2 },
    })
    map!.addLayer({
      id: 'wind-head',
      type: 'fill',
      source: 'wind',
      filter: ['==', ['geometry-type'], 'Polygon'],
      paint: { 'fill-color': '#0f766e' },
    })
    map!.on('mousemove', onMouseMove)
    if (props.result) render(props.result)
  })
})

onBeforeUnmount(() => {
  map?.remove()
  map = null
})

function onMouseMove(e: maplibregl.MapMouseEvent) {
  if (!props.result || rafPending) return
  rafPending = true
  requestAnimationFrame(() => {
    rafPending = false
    if (!props.result || !map) return
    const r = props.result
    const { lng, lat } = e.lngLat
    const lon = r.grid.lon_grid
    const la = r.grid.lat_grid
    let best = Infinity
    let br = 0
    let bc = 0
    // 粗网格暴力最近邻（默认约 1 万格点）
    for (let i = 0; i < la.length; i += 1) {
      for (let j = 0; j < lon[i].length; j += 1) {
        const dlon = lon[i][j] - lng
        const dlat = la[i][j] - lat
        const d = dlon * dlon + dlat * dlat
        if (d < best) {
          best = d
          br = i
          bc = j
        }
      }
    }
    hover.value = {
      lon: lng,
      lat,
      plume: r.plume_field_ug_m3[br][bc],
      total: r.total_conc_ug_m3[br][bc],
      bg: bgScalarAt(r, br, bc),
      inDomain: r.total_conc_ug_m3[br][bc] !== null,
      xm: r.grid.x_edges_m[bc],
      ym: r.grid.y_edges_m[br],
    }
  })
}

function windArrowFeature(r: PlumeGridResponse): GeoJSON.Feature[] {
  const corners = r.grid.corners_lonlat
  const sLon = (corners[0][0] + corners[3][0]) / 2
  const sLat = (corners[0][1] + corners[3][1]) / 2
  const eLon = (corners[1][0] + corners[2][0]) / 2
  const eLat = (corners[1][1] + corners[2][1]) / 2
  const lat0 = (sLat * Math.PI) / 180
  const mPerDegLon = R * Math.cos(lat0)
  const mPerDegLat = R
  // 箭头几何（米）-> 度；沿采样矩形下风向，头部在远端
  let dxE = (eLon - sLon) * mPerDegLon
  let dyN = (eLat - sLat) * mPerDegLat
  const norm = Math.hypot(dxE, dyN) || 1
  dxE /= norm
  dyN /= norm
  // 垂直方向（风的左侧）
  const px = -dyN
  const py = dxE
  const headLenM = 450
  const headWidthM = 180
  // 三角底心 = 箭头尖端沿风向后退 headLenM
  const baseLon = eLon - (dxE * headLenM) / mPerDegLon
  const baseLat = eLat - (dyN * headLenM) / mPerDegLat
  const wLon = (px * headWidthM) / mPerDegLon
  const wLat = (py * headWidthM) / mPerDegLat
  const tri: GeoJSON.Feature<GeoJSON.Polygon> = {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [eLon, eLat],
          [baseLon + wLon, baseLat + wLat],
          [baseLon - wLon, baseLat - wLat],
          [eLon, eLat],
        ],
      ],
    },
  }
  const line: GeoJSON.Feature<GeoJSON.LineString> = {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'LineString',
      coordinates: [
        [sLon, sLat],
        [eLon, eLat],
      ],
    },
  }
  return [line, tri]
}

function render(r: PlumeGridResponse) {
  if (!map || !map.getSource('fill')) return
  // 烟羽贡献填色（始终按“烟羽贡献”色带；与背景严格分开）
  const fillFC = props.showFill
    ? gridFillPolygons(
        r.plume_field_ug_m3,
        r.grid.lon_grid,
        r.grid.lat_grid,
        makeColorFor(r.iso_levels_ug_m3),
        0,
      )
    : { type: 'FeatureCollection' as const, features: [] }
  ;(map.getSource('fill') as maplibregl.GeoJSONSource).setData(fillFC as any)

  // 背景值叠加：常数模式＝采样矩形内单层灰蓝；
  // 线性梯度模式＝矩形内逐格点蓝绿填色，矩形外留空（null，不外推）
  const info = r.background_info
  const isGradient = info?.mode === 'linear_rect'
  let bgFC: GeoJSON.FeatureCollection
  if (!props.showBg) {
    bgFC = { type: 'FeatureCollection', features: [] }
  } else if (isGradient && typeof r.background_conc_ug_m3 !== 'number') {
    const bgField = r.background_conc_ug_m3
    const cfn = bgColorFor(info.min_ug_m3 ?? 0, info.max_ug_m3 ?? 0)
    bgFC = gridNullableFillPolygons(
      bgField,
      r.grid.lon_grid,
      r.grid.lat_grid,
      cfn,
    )
  } else if (!isGradient && (r.background_conc_ug_m3 as number) > 0) {
    bgFC = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {
            color: '#2563eb',
            bg: r.background_conc_ug_m3,
          },
          geometry: samplingBoundary(r.grid.corners_lonlat).geometry,
        },
      ],
    }
  } else {
    bgFC = { type: 'FeatureCollection', features: [] }
  }
  ;(map.getSource('bgval') as maplibregl.GeoJSONSource).setData(bgFC as any)
  map!.setLayoutProperty(
    'bgval-layer',
    'visibility',
    props.showBg ? 'visible' : 'none',
  )

  // 背景梯度定义域矩形
  const rectCorners = isGradient ? info.rect_corners_lonlat ?? [] : []
  ;(map.getSource('bgrect') as maplibregl.GeoJSONSource).setData({
    type: 'FeatureCollection',
    features: rectCorners.length ? [rectBoundary(rectCorners)] : [],
  } as any)
  map!.setLayoutProperty(
    'bgrect-line',
    'visibility',
    props.showBg && isGradient ? 'visible' : 'none',
  )

  // 等值线永远是“烟羽贡献”等值线
  const isoFeatures = props.showIso
    ? r.iso_levels_ug_m3.map((lv) =>
        marchingSquares(
          r.plume_field_ug_m3,
          r.grid.lon_grid,
          r.grid.lat_grid,
          lv,
        ),
      )
    : []
  ;(map.getSource('iso') as maplibregl.GeoJSONSource).setData({
    type: 'FeatureCollection',
    features: isoFeatures,
  } as any)

  ;(map.getSource('boundary') as maplibregl.GeoJSONSource).setData({
    type: 'FeatureCollection',
    features: [samplingBoundary(r.grid.corners_lonlat)],
  } as any)

  ;(map.getSource('wind') as maplibregl.GeoJSONSource).setData({
    type: 'FeatureCollection',
    features: windArrowFeature(r),
  } as any)

  // 源点标记
  sourceMarker?.remove()
  const el = document.createElement('div')
  el.style.cssText =
    'width:14px;height:14px;border-radius:50%;background:#111827;border:2px solid #fff;box-shadow:0 0 0 1px #111827;'
  el.title = r.source_term.name
  sourceMarker = new maplibregl.Marker({ element: el })
    .setLngLat(r.source_lonlat)
    .addTo(map)

  const ext = r.grid.sampling_extent_lonlat
  map.fitBounds(
    [
      [ext.lon_min, ext.lat_min],
      [ext.lon_max, ext.lat_max],
    ],
    { padding: 60, duration: 400 },
  )
}

function clearMap() {
  if (!map || !map.getSource('fill')) return
  const empty = { type: 'FeatureCollection' as const, features: [] }
  for (const id of ['fill', 'iso', 'bgval', 'bgrect', 'boundary', 'wind']) {
    ;(map.getSource(id) as maplibregl.GeoJSONSource).setData(empty as any)
  }
  sourceMarker?.remove()
  sourceMarker = null
}

watch(
  () => props.result,
  (r) => {
    if (r) render(r)
    else clearMap()
  },
)
watch(
  () => [props.showFill, props.showIso, props.showBg],
  () => {
    if (props.result) render(props.result)
  },
)
</script>

<template>
  <div class="map" id="map">
    <div v-if="result" class="mapinfo">
      <div><b>采样范围</b>（非无限精度）：{{ result.grid.nx }}×{{ result.grid.ny }} 节点</div>
      <div class="muted">
        间距 {{ result.grid.spacing_downwind_m.toFixed(0) }} /
        {{ result.grid.spacing_crosswind_m.toFixed(0) }} m（下风向/横风向）
      </div>
      <div class="muted">虚线矩形＝采样边界，结果不外推到界外</div>
    </div>
    <div v-if="hover" class="legend" style="width: 264px">
      <div><b>最近采样点</b>（x={{ hover.xm.toFixed(0) }} m, y={{ hover.ym.toFixed(0) }} m）</div>
      <div>烟羽贡献：<b>{{ hover.plume.toFixed(2) }}</b> μg/m³</div>
      <div>
        背景值：
        <template v-if="hover.bg !== null">{{ hover.bg.toFixed(2) }} μg/m³</template>
        <template v-else>
          <b>null（矩形外，背景未定义、不外推）</b>
        </template>
      </div>
      <div>
        总量：
        <template v-if="hover.total !== null">
          <b>{{ hover.total.toFixed(2) }}</b> μg/m³
        </template>
        <template v-else><b>null</b>（烟羽 {{ hover.plume.toFixed(2) }} 仍单独给出）</template>
      </div>
      <div class="muted">{{ hover.lon.toFixed(5) }}, {{ hover.lat.toFixed(5) }}</div>
    </div>
  </div>
</template>
