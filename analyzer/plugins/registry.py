from __future__ import annotations

import json
import logging
from typing import Any

import redis.asyncio as aioredis

from analyzer.config import Settings
from analyzer.plugins.base import FeaturePlugin, FrameContext
from analyzer.plugins.counter import CounterPlugin
from analyzer.plugins.crowd import CrowdPlugin
from analyzer.plugins.repack import RepackPlugin
from analyzer.plugins.shelf import ShelfPlugin
from analyzer.zones.engine import Event

logger = logging.getLogger(__name__)


class PluginManager:
    """Loads the tenant's enabled feature plugins and dispatches each frame.

    Enable state comes from Redis `features:{tenant_id}` — a JSON object
    {feature_id: {enabled: bool, config: {...}}} kept in sync by the API. For
    local dev without the DB/API in the loop, Settings.enabled_plugins
    force-enables plugins by id.
    """

    def __init__(self, settings: Settings, redis: aioredis.Redis) -> None:
        self.settings = settings
        self.redis = redis
        self._all: list[FeaturePlugin] = [
            CrowdPlugin(settings),
            CounterPlugin(settings, redis),
            RepackPlugin(settings),
            ShelfPlugin(settings),
        ]
        self._active: list[FeaturePlugin] = []

    async def load_features(self) -> None:
        raw = await self.redis.get(f"features:{self.settings.tenant_id}")
        feats: dict[str, Any] = json.loads(raw) if raw else {}
        for fid in self.settings.enabled_plugin_ids():
            feats.setdefault(fid, {"enabled": True, "config": {}})
        self._active = [p for p in self._all if p.is_enabled(feats)]
        logger.info("plugins active: %s",
                    [p.feature_id for p in self._active] or "none")

    async def dispatch(self, ctx: FrameContext) -> list[Event]:
        out: list[Event] = []
        for plugin in self._active:
            try:
                out.extend(await plugin.on_frame(ctx))
            except Exception:  # noqa: BLE001 — one plugin must not kill the frame
                logger.exception("plugin %s failed", plugin.feature_id)
        return out
