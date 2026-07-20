from __future__ import annotations

import logging
import time
from datetime import datetime, timezone
from typing import Any

import redis.asyncio as aioredis

from analyzer.config import Settings
from analyzer.plugins.base import BasePlugin, FrameContext
from analyzer.zones.engine import Event

logger = logging.getLogger(__name__)

GRID_W, GRID_H = 48, 27      # ~16:9, cell ≈ 2% of the frame
FLUSH_SECONDS = 60.0
KEY_TTL = 8 * 86_400         # hourly buckets live 8 days

# heatmap:{camera_id}:{YYYYMMDDHH} (UTC) → hash "x,y" → count
HEATMAP_KEY = "heatmap:{camera_id}:{hour}"


def _hour_bucket(ts: float) -> str:
    return datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y%m%d%H")


class HeatmapPlugin(BasePlugin):
    """Movement heatmap: track centers accumulated on a coarse grid, flushed
    to hourly Redis hashes the API renders over a camera snapshot. No models,
    no VRAM — pure counting.

    config:
      include_staff  bool  true — сотрудники тоже формируют карту
    """

    feature_id = "heatmap"
    version = "0.1"

    def __init__(self, settings: Settings, redis: aioredis.Redis) -> None:
        self.settings = settings
        self.redis = redis
        self._cfg: dict[str, Any] = {}
        # (camera_id, hour) → {(gx, gy): count}
        self._acc: dict[tuple[str, str], dict[tuple[int, int], int]] = {}
        self._last_flush = time.monotonic()

    async def teardown(self) -> None:
        await self._flush()

    async def on_frame(self, ctx: FrameContext) -> list[Event]:
        include_staff = bool(self._cfg.get("include_staff", True))
        if ctx.tracks:
            bucket = self._acc.setdefault((ctx.camera_id, _hour_bucket(ctx.ts)), {})
            for t in ctx.tracks:
                if not include_staff and t.staff:
                    continue
                gx = min(GRID_W - 1, max(0, int(t.center_norm[0] * GRID_W)))
                gy = min(GRID_H - 1, max(0, int(t.center_norm[1] * GRID_H)))
                bucket[(gx, gy)] = bucket.get((gx, gy), 0) + 1
        if time.monotonic() - self._last_flush >= FLUSH_SECONDS:
            await self._flush()
        return []

    async def _flush(self) -> None:
        self._last_flush = time.monotonic()
        if not self._acc:
            return
        acc, self._acc = self._acc, {}
        try:
            pipe = self.redis.pipeline()
            for (camera_id, hour), cells in acc.items():
                key = HEATMAP_KEY.format(camera_id=camera_id, hour=hour)
                for (gx, gy), count in cells.items():
                    pipe.hincrby(key, f"{gx},{gy}", count)
                pipe.expire(key, KEY_TTL)
            await pipe.execute()
        except Exception:  # noqa: BLE001 — drop the batch, keep the pipeline alive
            logger.exception("heatmap flush failed")
