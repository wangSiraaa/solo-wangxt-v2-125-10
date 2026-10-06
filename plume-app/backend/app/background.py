"""背景浓度场：空间常数（默认）或有限矩形内的线性梯度。

设计要点：
* 梯度模式为单次情景可选；缺省（background_gradient=None）时保持原常数背景，
  行为与旧版本完全一致。
* 线性背景在以源为原点的局部平面坐标 (E, N)（米）上定义：

      bg(E, N) = base + slope_east · E/1000 + slope_north · N/1000

  网格节点与任意受体点都先经 geometry.lonlat_to_local 换算到同一 (E, N)，
  因此背景值由物理位置唯一决定，与采样网格分辨率无关。
* 背景只在指定矩形 [east_min, east_max] × [north_min, north_max] 内有效：
  矩形外**不评估、不外推**——网格请求直接拒绝（422），
  点请求逐点返回明确说明（背景与总量为 null）。
* 矩形内任一点背景 < 0 时拒绝/标注，绝不悄悄截断为 0。
"""
from __future__ import annotations

import numpy as np

from .gaussian import PlumeInputError
from .geometry import local_to_lonlat
from .schemas import BackgroundGradientInput

# 矩形边界容差（米）：浮点网格节点恰好落在边界上时判为界内
RECT_TOL_M = 1e-6


def _inside_mask(spec: BackgroundGradientInput, e, n):
    return (
        (e >= spec.east_min_m - RECT_TOL_M)
        & (e <= spec.east_max_m + RECT_TOL_M)
        & (n >= spec.north_min_m - RECT_TOL_M)
        & (n <= spec.north_max_m + RECT_TOL_M)
    )


def _rect_desc(spec: BackgroundGradientInput) -> str:
    return (
        f"E∈[{spec.east_min_m:g}, {spec.east_max_m:g}] m, "
        f"N∈[{spec.north_min_m:g}, {spec.north_max_m:g}] m"
        "（以源为原点的局部平面坐标）"
    )


def _linear(spec: BackgroundGradientInput, e, n):
    return (
        spec.base_value_ug_m3
        + spec.slope_east_ug_m3_per_km * np.asarray(e, dtype=float) / 1000.0
        + spec.slope_north_ug_m3_per_km * np.asarray(n, dtype=float) / 1000.0
    )


def gradient_background_field(
    spec: BackgroundGradientInput,
    east_m,
    north_m,
) -> np.ndarray:
    """在网格节点 (E, N)（米）上评估线性背景（μg/m³）。

    任一节点在矩形之外 → PlumeInputError（不外推）；
    矩形内出现负背景 → PlumeInputError（不截断为 0）。
    """
    e = np.asarray(east_m, dtype=float)
    n = np.asarray(north_m, dtype=float)
    if not bool(np.all(_inside_mask(spec, e, n))):
        raise PlumeInputError(
            "采样网格超出背景梯度矩形（"
            + _rect_desc(spec)
            + f"）：网格范围 E∈[{float(e.min()):.0f}, {float(e.max()):.0f}] m, "
            f"N∈[{float(n.min()):.0f}, {float(n.max()):.0f}] m。"
            "背景值不向矩形外外推；请扩大背景矩形或缩小采样网格。"
        )
    bg = _linear(spec, e, n)
    min_bg = float(np.min(bg))
    if min_bg < 0.0:
        idx = np.unravel_index(int(np.argmin(bg)), bg.shape)
        raise PlumeInputError(
            f"线性背景在矩形内出现负值：最小 {min_bg:.3g} μg/m³ "
            f"（E={float(e[idx]):.0f} m, N={float(n[idx]):.0f} m）。"
            "背景浓度不能为负；请减小斜率、提高基准值或缩小矩形。"
        )
    return bg


def gradient_background_point(
    spec: BackgroundGradientInput,
    e: float,
    n: float,
) -> tuple[float | None, str | None]:
    """单受体点背景评估。

    矩形外或负值不抛异常，返回 (None, 明确说明)，绝不外推/截断。
    """
    if not bool(_inside_mask(spec, e, n)):
        return None, (
            f"该点 (E={e:.0f} m, N={n:.0f} m) 位于背景梯度矩形之外（"
            + _rect_desc(spec)
            + "）：背景值不外推，该点背景与总量不可用。"
        )
    bg = float(_linear(spec, e, n))
    if bg < 0.0:
        return None, (
            f"线性背景在该点为负（{bg:.3g} μg/m³），不予采用；"
            "请减小斜率、提高基准值或缩小矩形。"
        )
    return bg, None


def gradient_rect_corners_lonlat(
    spec: BackgroundGradientInput,
    lon0: float,
    lat0: float,
) -> list[list[float]]:
    """背景矩形四角（经纬度，SW→SE→NE→NW），供前端绘制有效范围。"""
    corners = []
    for e, n in [
        (spec.east_min_m, spec.north_min_m),
        (spec.east_max_m, spec.north_min_m),
        (spec.east_max_m, spec.north_max_m),
        (spec.east_min_m, spec.north_max_m),
    ]:
        lon, lat = local_to_lonlat(e, n, lon0, lat0)
        corners.append([float(lon), float(lat)])
    return corners
