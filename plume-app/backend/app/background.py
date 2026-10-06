"""单次情景专用：有限矩形内的线性背景梯度。

背景在矩形**内部**沿东(E)、北(N)方向线性变化：

    C_bg(E, N) = base + dC_dE * E + dC_dN * N

* (E, N) 是以**排放源为原点**的局部等距圆柱平面坐标（米），与网格、
  任意受体点求值使用 :mod:`app.geometry` 中**同一套**换算，
  因此同一受体点的背景值与采样分辨率无关。
* 仅当点落在闭矩形 [e_min, e_max] × [n_min, n_max] 内时给出背景值；
  矩形外返回 ``None``（掩码标记），**绝不外推**。
* 调用方负责校验 base 与矩形四角取值均非负——线性函数的极值在角点，
  四角非负则矩形内处处非负；负背景在请求层即被拒绝。

未指定梯度时沿用旧的空间常数背景（见 services.prepare_background）。
"""
from __future__ import annotations

from typing import Any

import numpy as np


def gradient_corner_values(
    base_ug_m3: float,
    dcd_east_ug_m3_m: float,
    dcd_north_ug_m3_m: float,
    e_min_m: float,
    e_max_m: float,
    n_min_m: float,
    n_max_m: float,
) -> dict[str, float]:
    """矩形四角（源原点处为 base）的背景值；用于非负校验与图例。"""
    corners = {
        "sw": base_ug_m3
        + dcd_east_ug_m3_m * e_min_m
        + dcd_north_ug_m3_m * n_min_m,
        "se": base_ug_m3
        + dcd_east_ug_m3_m * e_max_m
        + dcd_north_ug_m3_m * n_min_m,
        "ne": base_ug_m3
        + dcd_east_ug_m3_m * e_max_m
        + dcd_north_ug_m3_m * n_max_m,
        "nw": base_ug_m3
        + dcd_east_ug_m3_m * e_min_m
        + dcd_north_ug_m3_m * n_max_m,
    }
    return corners


def evaluate_linear_background(
    east_m,
    north_m,
    gradient: Any,
) -> tuple[np.ndarray, np.ndarray]:
    """在任意形状的 E/N 坐标数组上求背景。

    返回 ``(values, inside)``：

    * ``values``：object 数组，矩形内为 float（np.float64），矩形外为 ``None``；
      序列化为 JSON 时矩形外即 ``null``，绝不悄悄外推。
    * ``inside``：布尔数组，标记背景定义域。

    ``gradient`` 为 :class:`app.schemas.BackgroundGradient`。
    """
    e = np.asarray(east_m, dtype=float)
    n = np.asarray(north_m, dtype=float)
    inside = (
        (e >= gradient.e_min_m)
        & (e <= gradient.e_max_m)
        & (n >= gradient.n_min_m)
        & (n <= gradient.n_max_m)
    )
    raw = (
        gradient.base_ug_m3
        + gradient.dcd_east_ug_m3_m * e
        + gradient.dcd_north_ug_m3_m * n
    )
    values = np.empty(e.shape, dtype=object)
    # 闭矩形：边界点也属于定义域；内部值在请求层已保证非负
    values[inside] = raw[inside]
    # 显式置 None，避免 object 数组残留
    values[~inside] = None
    return values, inside


def scalar_linear_background(
    east_m: float,
    north_m: float,
    gradient: Any,
) -> tuple[float | None, bool]:
    """单受体点（任意经纬度点求值）上的背景；矩形外返回 (None, False)。"""
    inside = (
        gradient.e_min_m <= east_m <= gradient.e_max_m
        and gradient.n_min_m <= north_m <= gradient.n_max_m
    )
    if not inside:
        return None, False
    return (
        gradient.base_ug_m3
        + gradient.dcd_east_ug_m3_m * east_m
        + gradient.dcd_north_ug_m3_m * north_m
    ), True


def gradient_metadata(gradient: Any) -> dict:
    """组装响应中的背景定义说明（矩形、斜率、四角值、角点经纬度由调用方补）。"""
    corners = gradient_corner_values(
        gradient.base_ug_m3,
        gradient.dcd_east_ug_m3_m,
        gradient.dcd_north_ug_m3_m,
        gradient.e_min_m,
        gradient.e_max_m,
        gradient.n_min_m,
        gradient.n_max_m,
    )
    values = list(corners.values())
    return {
        "mode": "linear_rect",
        "formula": "C_bg(E,N) = base + dC_dE*E + dC_dN*N（E/N 以源为原点，米）",
        "base_ug_m3": float(gradient.base_ug_m3),
        "base_anchor": "排放源位置（E=N=0）；源点落在矩形外时 base 仍为截距",
        "dcd_east_ug_m3_m": float(gradient.dcd_east_ug_m3_m),
        "dcd_north_ug_m3_m": float(gradient.dcd_north_ug_m3_m),
        "rect_east_m": [
            float(gradient.e_min_m),
            float(gradient.e_max_m),
        ],
        "rect_north_m": [
            float(gradient.n_min_m),
            float(gradient.n_max_m),
        ],
        "corner_values_ug_m3": {k: float(v) for k, v in corners.items()},
        "min_ug_m3": float(min(values)),
        "max_ug_m3": float(max(values)),
        "outside_rect_behavior": (
            "矩形外背景未定义：background/total 返回 null，"
            "不做任何外推；烟羽贡献仍单独返回"
        ),
        "non_negative_note": "已校验 base 与矩形四角取值均 ≥ 0，矩形内处处非负",
    }
