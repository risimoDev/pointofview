from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np
import numpy.typing as npt

from analyzer.config import Settings
from analyzer.plugins.base import BasePlugin, FrameContext, TrackInfo
from analyzer.zones.engine import Event, Zone

_SIG = 32  # signature grid size (downsampled gray)


def _bbox_px(zone: Zone, w: int, h: int) -> tuple[int, int, int, int]:
    xs = [p[0] for p in zone.polygon]
    ys = [p[1] for p in zone.polygon]
    x1 = max(0, min(int(min(xs) * w), w - 1))
    x2 = max(x1 + 1, min(int(max(xs) * w), w))
    y1 = max(0, min(int(min(ys) * h), h - 1))
    y2 = max(y1 + 1, min(int(max(ys) * h), h))
    return x1, y1, x2, y2


def _signature(frame: npt.NDArray[Any], box: tuple[int, int, int, int]) -> npt.NDArray[np.float32] | None:
    x1, y1, x2, y2 = box
    crop = frame[y1:y2, x1:x2]
    if crop.size == 0:
        return None
    gray = crop.mean(axis=2) if crop.ndim == 3 else crop
    gh, gw = gray.shape
    ys = np.linspace(0, gh - 1, _SIG).astype(int)
    xs = np.linspace(0, gw - 1, _SIG).astype(int)
    return np.asarray(gray[np.ix_(ys, xs)], dtype=np.float32)


def _overlaps(track: TrackInfo, box: tuple[int, int, int, int]) -> bool:
    tx1, ty1, tx2, ty2 = track.bbox
    bx1, by1, bx2, by2 = box
    return not (tx2 < bx1 or tx1 > bx2 or ty2 < by1 or ty1 > by2)


@dataclass(slots=True)
class _ShelfState:
    baseline: npt.NDArray[np.float32]
    occluded: bool = False       # a person overlapped the shelf since last settle
    clear_since: float | None = None


class ShelfPlugin(BasePlugin):
    """Detects item taken/placed on a `shelf` zone by comparing the region to a
    reference frame. A change only counts as a `shelf_violation` if a person
    occluded the shelf beforehand (a real interaction); pure lighting drift just
    re-baselines. Pixel-based, needs ctx.frame.

    TODO: identify the specific parcel via QR/label OCR on the changed crop.

    config:
      change_threshold   float  mean |Δ| / 255 to count as a change (default 0.10)
      settle_seconds     float  clear-of-people time before comparing (default 1.5)
      check_interval     float  min seconds between checks per camera (default 1.0)
    """

    feature_id = "shelf"

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._cfg: dict[str, Any] = {}
        self._state: dict[tuple[str, str], _ShelfState] = {}   # (camera, zone) -> state
        self._last_check: dict[str, float] = {}                # camera -> ts

    def is_enabled(self, tenant_features: dict[str, Any]) -> bool:
        feat = tenant_features.get(self.feature_id)
        if not feat or not feat.get("enabled"):
            return False
        self._cfg = feat.get("config") or {}
        return True

    async def on_frame(self, ctx: FrameContext) -> list[Event]:
        if ctx.frame is None:
            return []
        shelves = [z for z in ctx.zones if z.kind == "shelf"]
        if not shelves:
            return []

        interval = float(self._cfg.get("check_interval", 1.0))
        last = self._last_check.get(ctx.camera_id)
        if last is not None and ctx.ts - last < interval:
            return []
        self._last_check[ctx.camera_id] = ctx.ts

        threshold = float(self._cfg.get("change_threshold", 0.10))
        settle = float(self._cfg.get("settle_seconds", 1.5))

        out: list[Event] = []
        for zone in shelves:
            box = _bbox_px(zone, ctx.frame_w, ctx.frame_h)
            sig = _signature(ctx.frame, box)
            if sig is None:
                continue
            occluded = any(_overlaps(t, box) for t in ctx.tracks)
            key = (ctx.camera_id, zone.id)
            st = self._state.get(key)

            if st is None:
                self._state[key] = _ShelfState(baseline=sig, occluded=occluded,
                                               clear_since=None if occluded else ctx.ts)
                continue

            if occluded:
                st.occluded = True
                st.clear_since = None
                continue

            if st.clear_since is None:
                st.clear_since = ctx.ts
            if ctx.ts - st.clear_since < settle:
                continue

            diff = float(np.mean(np.abs(sig - st.baseline))) / 255.0
            if st.occluded and diff >= threshold:
                out.append(Event(
                    tenant_id=ctx.tenant_id, site_id=ctx.site_id, camera_id=ctx.camera_id,
                    zone_id=zone.id, type="shelf_violation", severity="warn",
                    meta={"change": round(diff, 4), "kind": "shelf"}, ts_start=ctx.ts,
                ))
            # adopt the new stable appearance as baseline either way
            st.baseline = sig
            st.occluded = False
        return out
