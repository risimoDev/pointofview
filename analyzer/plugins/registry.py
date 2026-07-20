from __future__ import annotations

import json
import logging
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import redis.asyncio as aioredis

from analyzer.config import Settings
from analyzer.plugins.base import FeaturePlugin, FrameContext
from analyzer.plugins.counter import CounterPlugin
from analyzer.plugins.crowd import CrowdPlugin
from analyzer.plugins.heatmap import HeatmapPlugin
from analyzer.plugins.ppe import PpePlugin
from analyzer.plugins.pose import PosePlugin
from analyzer.plugins.repack import RepackPlugin
from analyzer.plugins.shelf import ShelfPlugin
from analyzer.plugins.tamper import TamperPlugin
from analyzer.zones.engine import Event

logger = logging.getLogger(__name__)

# plugin_status:{tenant} → JSON for the admin UI; refreshed on every
# load_features tick so it doubles as an "analyzer is alive" signal.
STATUS_KEY = "plugin_status:{tenant_id}"
STATUS_TTL = 120  # seconds; stale status disappears with a dead worker

# an errored/vram_exceeded setup is retried at most this often — without the
# backoff a vram_exceeded plugin would load+unload its model every refresh
# tick. Toggling the feature off/on clears the backoff (instant retry).
SETUP_RETRY_SECONDS = 300.0


def _vram_allocated_mb() -> float | None:
    """Torch-allocated VRAM of this process, MB. None on CPU-only."""
    try:
        import torch

        if torch.cuda.is_available():
            return float(torch.cuda.memory_allocated()) / 1e6
    except Exception:  # noqa: BLE001 — metrics must never break the pipeline
        pass
    return None


class PluginManager:
    """Loads the tenant's enabled feature plugins and dispatches each frame.

    Enable state comes from Redis `features:{tenant_id}` — a JSON object
    {feature_id: {enabled: bool, config: {...}}} kept in sync by the API. For
    local dev without the DB/API in the loop, Settings.enabled_plugins
    force-enables plugins by id.

    Lifecycle: on every load_features() the wanted set is diffed against the
    active set — newly enabled plugins get setup() (model → VRAM), disabled
    ones get teardown() (VRAM freed). A setup failure or a busted VRAM budget
    marks the plugin errored/vram_exceeded and keeps it inactive; per-plugin
    status is published to plugin_status:{tenant} for the admin UI.
    """

    def __init__(
        self,
        settings: Settings,
        redis: aioredis.Redis,
        gpu_pool: ThreadPoolExecutor | None = None,
    ) -> None:
        self.settings = settings
        self.redis = redis
        self._all: list[FeaturePlugin] = [
            CrowdPlugin(settings),
            CounterPlugin(settings, redis),
            RepackPlugin(settings),
            ShelfPlugin(settings),
            PpePlugin(settings, gpu_pool),
            PosePlugin(settings, gpu_pool),
            TamperPlugin(settings),
            HeatmapPlugin(settings, redis),
        ]
        self._active: list[FeaturePlugin] = []
        # feature_id → {state, vram_mb, error, ...} for plugin_status:{tenant}
        self._status: dict[str, dict[str, Any]] = {}
        self._failed_at: dict[str, float] = {}  # feature_id → last setup failure ts

    # ── lifecycle ─────────────────────────────────────────────
    async def load_features(self) -> None:
        raw = await self.redis.get(f"features:{self.settings.tenant_id}")
        feats: dict[str, Any] = json.loads(raw) if raw else {}
        for fid in self.settings.enabled_plugin_ids():
            feats.setdefault(fid, {"enabled": True, "config": {}})

        wanted = [p for p in self._all if p.is_enabled(feats)]
        previous = [p.feature_id for p in self._active]

        for plugin in list(self._active):
            if plugin not in wanted:
                await self._deactivate(plugin)

        active: list[FeaturePlugin] = []
        now = time.time()
        for plugin in wanted:
            if plugin in self._active:
                active.append(plugin)
                continue
            failed_at = self._failed_at.get(plugin.feature_id)
            if failed_at is not None and now - failed_at < SETUP_RETRY_SECONDS:
                continue  # backoff; previous error status stays published
            cfg = (feats.get(plugin.feature_id) or {}).get("config") or {}
            if await self._activate(plugin, cfg):
                active.append(plugin)
                self._failed_at.pop(plugin.feature_id, None)
            else:
                self._failed_at[plugin.feature_id] = now
        self._active = active

        for plugin in self._all:
            if plugin not in wanted:
                # errored plugins were never in _active, so clear their backoff
                # here too — toggling off/on must always retry immediately
                self._failed_at.pop(plugin.feature_id, None)
                self._set_status(plugin, "off")
        await self._publish_status()

        current = [p.feature_id for p in self._active]
        if current != previous:
            logger.info("plugins active: %s", current or "none")

    async def _activate(self, plugin: FeaturePlugin, cfg: dict[str, Any]) -> bool:
        before = _vram_allocated_mb()
        try:
            await plugin.setup(cfg)
        except Exception as exc:  # noqa: BLE001 — degrade, don't kill the worker
            logger.exception("plugin %s: setup failed", plugin.feature_id)
            self._set_status(plugin, "error", error=str(exc))
            return False

        after = _vram_allocated_mb()
        vram_mb = round(after - before, 1) if before is not None and after is not None else None

        budget = self.settings.vram_budget_mb
        if budget > 0 and after is not None and after > budget:
            logger.warning(
                "plugin %s: VRAM budget exceeded (%.0f MB allocated > %d MB budget), unloading",
                plugin.feature_id, after, budget,
            )
            await self._safe_teardown(plugin)
            self._set_status(plugin, "vram_exceeded", vram_mb=vram_mb)
            return False

        self._set_status(plugin, "active", vram_mb=vram_mb)
        logger.info(
            "plugin %s v%s: setup ok (model=%s, vram=%s MB)",
            plugin.feature_id, plugin.version, plugin.model_version, vram_mb,
        )
        return True

    async def _deactivate(self, plugin: FeaturePlugin) -> None:
        await self._safe_teardown(plugin)
        self._failed_at.pop(plugin.feature_id, None)  # off/on = instant retry
        self._set_status(plugin, "off")
        logger.info("plugin %s: teardown (disabled)", plugin.feature_id)

    async def _safe_teardown(self, plugin: FeaturePlugin) -> None:
        try:
            await plugin.teardown()
        except Exception:  # noqa: BLE001
            logger.exception("plugin %s: teardown failed", plugin.feature_id)

    # ── status for the admin UI ───────────────────────────────
    def _set_status(
        self,
        plugin: FeaturePlugin,
        state: str,
        vram_mb: float | None = None,
        error: str | None = None,
    ) -> None:
        self._status[plugin.feature_id] = {
            "feature_id": plugin.feature_id,
            "state": state,  # active | off | error | vram_exceeded
            "version": plugin.version,
            "model": plugin.model_version,
            "vram_mb": vram_mb,
            "error": error,
            "ts": time.time(),
        }

    async def _publish_status(self) -> None:
        try:
            await self.redis.set(
                STATUS_KEY.format(tenant_id=self.settings.tenant_id),
                json.dumps(list(self._status.values())),
                ex=STATUS_TTL,
            )
        except Exception:  # noqa: BLE001 — status is best-effort
            logger.exception("plugin status publish failed")

    # ── main detector class requirements ──────────────────────
    def extra_detector_classes(self) -> frozenset[int]:
        """Union of extra class ids the active plugins want from the MAIN
        detector (person is always detected regardless)."""
        out: frozenset[int] = frozenset()
        for plugin in self._active:
            out |= plugin.detector_classes
        return out

    # ── dispatch ──────────────────────────────────────────────
    async def dispatch(self, ctx: FrameContext) -> list[Event]:
        out: list[Event] = []
        for plugin in self._active:
            try:
                events = await plugin.on_frame(ctx)
            except Exception:  # noqa: BLE001 — one plugin must not kill the frame
                logger.exception("plugin %s failed", plugin.feature_id)
                continue
            # every event records which model produced it (AI-17)
            version = plugin.model_version or f"{plugin.feature_id}/{plugin.version}"
            for ev in events:
                ev.meta.setdefault("model_version", version)
            out.extend(events)
        return out
