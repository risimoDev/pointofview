from __future__ import annotations

import asyncio
import json
import logging
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

import numpy as np
import redis.asyncio as aioredis
import supervision as sv

from analyzer.config import CameraConfig, Settings
from analyzer.detect.base import PERSON_CLASS, Detection, make_detector
from analyzer.ingest.video_source import (
    FileSource,
    Frame,
    RtspPullSource,
    VideoSource,
)
from analyzer.plugins import FrameContext, PluginManager, TrackInfo
from analyzer.reid import IdentityManager
from analyzer.zones.engine import TrackEvent, ZoneEngine

logger = logging.getLogger(__name__)

# Liveness heartbeat: refreshed while frames flow, expires on stall/crash.
# The API maps key presence to the camera's online/offline badge.
HEARTBEAT_KEY = "camera_alive:{camera_id}"
HEARTBEAT_TTL = 15   # seconds a camera stays "online" after the last frame
HEARTBEAT_EVERY = 5  # min seconds between SETEX calls per camera


def _iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat().replace("+00:00", "Z")


def _to_sv(dets: list[Detection]) -> sv.Detections:
    """Person detections → sv.Detections for ByteTrack (its native input)."""
    if not dets:
        return sv.Detections.empty()
    return sv.Detections(
        xyxy=np.array([d.bbox for d in dets], dtype=np.float32),
        confidence=np.array([d.confidence for d in dets], dtype=np.float32),
        class_id=np.array([d.class_id for d in dets], dtype=int),
    )


class AnalyzerWorker:
    """Single GPU process. Runs all tenant cameras concurrently via asyncio;
    YOLO inference is serialized on one executor thread to share the GPU.
    """

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.redis = aioredis.from_url(settings.redis_url, decode_responses=True)

        self.detector = make_detector(settings)

        # single GPU thread: main detector AND plugin models share it, so GPU
        # work stays serialized no matter how many models are enabled
        self._infer_pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="gpu")
        self._trackers: dict[str, sv.ByteTrack] = {}
        self._site_by_camera: dict[str, str] = {}
        self._tz_by_camera: dict[str, str] = {}
        self._tasks: dict[str, asyncio.Task[None]] = {}  # camera_id → consumer
        self._infer_ms_ema = 0.0  # capacity metric (docs/CAPACITY-ANALYSIS.md, 9)
        self.zones = ZoneEngine(self.redis, settings)
        self.plugins = PluginManager(settings, self.redis, self._infer_pool)
        self.identity = IdentityManager(settings, self.redis)

    # ── camera discovery ──────────────────────────────────────
    async def _load_cameras(self) -> list[CameraConfig]:
        raw = await self.redis.get(f"cameras:{self.settings.tenant_id}")
        if not raw:
            return []  # supervisor re-checks periodically; no spammy warning
        return [CameraConfig.model_validate(c) for c in json.loads(raw)]

    def _make_source(self, cfg: CameraConfig) -> VideoSource:
        self._site_by_camera[cfg.id] = cfg.site_id
        self._tz_by_camera[cfg.id] = cfg.tz
        skip = cfg.frame_skip(self.settings.default_frame_skip)
        if cfg.source_type == "file":
            return FileSource(cfg.id, self.settings.tenant_id, cfg.ai_url(), frame_skip=skip)
        # rtsp_pull / srt_push both pulled via OpenCV/FFmpeg
        return RtspPullSource(
            cfg.id,
            self.settings.tenant_id,
            cfg.ai_url(),
            frame_skip=skip,
            max_backoff=self.settings.max_backoff_seconds,
        )

    # ── inference (runs in the single GPU thread) ─────────────
    def _infer(self, frame: Frame, classes: list[int]) -> list[Detection]:
        t0 = time.perf_counter()
        detections = self.detector.detect(frame.data, classes)
        elapsed_ms = (time.perf_counter() - t0) * 1000.0
        self._infer_ms_ema = self._infer_ms_ema * 0.95 + elapsed_ms * 0.05
        return detections

    async def _process(self, frame: Frame) -> None:
        loop = asyncio.get_running_loop()
        # person always; active plugins may request extra classes (future
        # multi-class model — PPE etc.); plugins with their own model don't
        classes = sorted({PERSON_CLASS, *self.plugins.extra_detector_classes()})
        detections = await loop.run_in_executor(self._infer_pool, self._infer, frame, classes)
        persons = [d for d in detections if d.class_id == PERSON_CLASS]
        others = [d for d in detections if d.class_id != PERSON_CLASS]

        tracker = self._trackers.setdefault(frame.camera_id, sv.ByteTrack())
        tracked = tracker.update_with_detections(_to_sv(persons))

        frame_h, frame_w = frame.data.shape[0], frame.data.shape[1]
        site_id = self._site_by_camera.get(frame.camera_id, "")
        await self.identity.ensure_site(site_id)
        zone_events = []
        track_infos: list[TrackInfo] = []

        for i in range(len(tracked)):
            track_id = tracked.tracker_id[i]
            if track_id is None:
                continue
            x1, y1, x2, y2 = (float(v) for v in tracked.xyxy[i])
            confidence = float(tracked.confidence[i]) if tracked.confidence is not None else 0.0
            class_id = int(tracked.class_id[i]) if tracked.class_id is not None else PERSON_CLASS

            # cross-camera identity + staff flag (reid feature; no-op when off)
            ident = self.identity.resolve(
                frame.camera_id, site_id, int(track_id),
                frame.data, (x1, y1, x2, y2), frame.ts, confidence,
            )

            cx = (x1 + x2) / 2.0 / frame_w
            cy = (y1 + y2) / 2.0 / frame_h
            track_infos.append(TrackInfo(
                track_id=int(track_id),
                bbox=(x1, y1, x2, y2),
                center_norm=(cx, cy),
                confidence=confidence,
                zone_ids=frozenset(self.zones.zones_containing(frame.camera_id, cx, cy)),
                global_id=ident.global_id,
                staff=ident.staff,
                reid_pending=ident.pending,
            ))

            payload = {
                "stream": self.settings.track_events_stream,
                "tenant_id": frame.tenant_id,
                "camera_id": frame.camera_id,
                "track_id": int(track_id),
                "bbox": {"x1": x1, "y1": y1, "x2": x2, "y2": y2},
                "class_id": class_id,
                "confidence": confidence,
                "zone_id": None,   # zone_engine fills this downstream
                "dwell_sec": 0.0,
                "global_id": ident.global_id,
                "staff": ident.staff,
                "ts": _iso(frame.ts),
            }
            await self.redis.xadd(
                self.settings.track_events_stream,
                {"data": json.dumps(payload)},
                maxlen=self.settings.stream_maxlen,
                approximate=True,
            )

            # geofencing + dwell → events stream
            te = TrackEvent(
                tenant_id=frame.tenant_id,
                site_id=site_id,
                camera_id=frame.camera_id,
                track_id=int(track_id),
                bbox=(x1, y1, x2, y2),
                frame_w=frame_w,
                frame_h=frame_h,
                confidence=confidence,
                ts=frame.ts,
                staff=ident.staff,
                global_id=ident.global_id,
                tz=self._tz_by_camera.get(frame.camera_id, "Europe/Moscow"),
            )
            zone_events.extend(self.zones.process(te))

        if zone_events:
            # zone events come from the main detector's tracks (AI-17)
            for ev in zone_events:
                ev.meta.setdefault("model_version", self.detector.model_version)
            await self.zones.emit(zone_events)

        # feature plugins run on the whole-frame view (all tracks + zones)
        ctx = FrameContext(
            tenant_id=frame.tenant_id,
            site_id=site_id,
            camera_id=frame.camera_id,
            frame_w=frame_w,
            frame_h=frame_h,
            ts=frame.ts,
            tracks=track_infos,
            zones=self.zones.active_zones(frame.camera_id),
            frame=frame.data,
            detections=others,
        )
        plugin_events = await self.plugins.dispatch(ctx)
        if plugin_events:
            await self.zones.emit(plugin_events)

    # ── per-camera consumer; isolated so one failure stays local
    async def _consume(self, source: VideoSource) -> None:
        key = HEARTBEAT_KEY.format(camera_id=source.camera_id)
        last_beat = 0.0
        try:
            async for frame in source.frames():
                now = time.monotonic()
                if now - last_beat >= HEARTBEAT_EVERY:
                    last_beat = now
                    try:
                        await self.redis.setex(key, HEARTBEAT_TTL, "1")
                    except Exception:  # noqa: BLE001 — heartbeat must not kill the consumer
                        pass
                await self._process(frame)
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001 — keep other cameras alive
            logger.exception("camera %s: consumer crashed", source.camera_id)

    async def run(self) -> None:
        # Long-lived supervisor: never exits on zero cameras (a fresh deploy
        # would otherwise exit → docker restart loop). Per-camera consumers are
        # started/stopped as the cameras:{tenant} set changes, so admin
        # add/remove/upload takes effect without restarting the worker.
        await self.plugins.load_features()
        await self.identity.refresh()
        bg = [
            asyncio.create_task(self.zones.run_refresh()),
            asyncio.create_task(self._refresh_features()),
            asyncio.create_task(self._camera_supervisor()),
            asyncio.create_task(self._identity_loop()),
        ]
        try:
            await asyncio.gather(*bg)
        finally:
            for t in bg:
                t.cancel()
            for t in list(self._tasks.values()):
                t.cancel()

    async def _camera_supervisor(self) -> None:
        while True:
            try:
                await self._sync_sources()
            except Exception:  # noqa: BLE001
                logger.exception("camera sync failed")
            try:
                await self._publish_metrics()
            except Exception:  # noqa: BLE001
                logger.exception("metrics publish failed")
            await asyncio.sleep(self.settings.zone_refresh_seconds)

    async def _publish_metrics(self) -> None:
        """Capacity numbers the admin UI / future monitoring can read; until
        these are measured, capacity planning is a guess (CAPACITY-ANALYSIS, 9)."""
        payload = {
            "infer_ms": round(self._infer_ms_ema, 1),
            "detector": self.detector.model_version,
            "cameras": len(self._tasks),
            "ts": time.time(),
        }
        try:
            import torch

            if torch.cuda.is_available():
                payload["vram_allocated_mb"] = round(torch.cuda.memory_allocated() / 1e6)
                payload["vram_total_mb"] = round(
                    torch.cuda.get_device_properties(0).total_memory / 1e6
                )
        except Exception:  # noqa: BLE001
            pass
        await self.redis.set(
            f"analyzer_metrics:{self.settings.tenant_id}", json.dumps(payload), ex=120,
        )

    async def _sync_sources(self) -> None:
        wanted = {c.id: c for c in await self._load_cameras()}

        for cam_id, cfg in wanted.items():
            task = self._tasks.get(cam_id)
            if task and not task.done():
                continue  # already running
            try:
                source = self._make_source(cfg)
            except ValueError:
                logger.exception("camera %s: bad config, skipping", cam_id)
                continue
            await self.zones.load_zones([cam_id])
            self._tasks[cam_id] = asyncio.create_task(self._consume(source))
            logger.info("camera %s: started (%s)", cam_id, cfg.source_type)

        for cam_id in list(self._tasks):
            if cam_id not in wanted:
                self._tasks[cam_id].cancel()
                del self._tasks[cam_id]
                logger.info("camera %s: removed, stopped", cam_id)

    async def _identity_loop(self) -> None:
        """Re-read reid config/staff gallery + persist dirty embeddings/crops."""
        while True:
            await asyncio.sleep(10)
            try:
                await self.identity.refresh()
                await self.identity.sync()
            except Exception:  # noqa: BLE001
                logger.exception("reid sync failed")

    async def _refresh_features(self) -> None:
        """Re-read enabled features so admin toggles apply without a restart.
        Reuses the same plugin instances → per-camera state is preserved."""
        while True:
            await asyncio.sleep(self.settings.zone_refresh_seconds)
            try:
                await self.plugins.load_features()
            except Exception:  # noqa: BLE001
                logger.exception("feature refresh failed")

    async def aclose(self) -> None:
        self._infer_pool.shutdown(wait=False)
        await self.redis.aclose()


def main() -> None:
    settings = Settings()  # type: ignore[call-arg]  # values from env
    logging.basicConfig(
        level=settings.log_level,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    worker = AnalyzerWorker(settings)
    try:
        asyncio.run(worker.run())
    except KeyboardInterrupt:
        pass
    finally:
        asyncio.run(worker.aclose())


if __name__ == "__main__":
    main()
