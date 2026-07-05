from __future__ import annotations

import asyncio
import json
import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

import redis.asyncio as aioredis
import supervision as sv
from ultralytics import YOLO

from analyzer.config import CameraConfig, Settings
from analyzer.ingest.video_source import (
    FileSource,
    Frame,
    RtspPullSource,
    VideoSource,
)
from analyzer.plugins import FrameContext, PluginManager, TrackInfo
from analyzer.zones.engine import TrackEvent, ZoneEngine

logger = logging.getLogger(__name__)

PERSON_CLASS = 0  # COCO person


def _iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat().replace("+00:00", "Z")


class AnalyzerWorker:
    """Single GPU process. Runs all tenant cameras concurrently via asyncio;
    YOLO inference is serialized on one executor thread to share the GPU.
    """

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.redis = aioredis.from_url(settings.redis_url, decode_responses=True)

        self.model = YOLO(settings.yolo_model)
        self.model.to(settings.analyzer_device)

        self._infer_pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="yolo")
        self._trackers: dict[str, sv.ByteTrack] = {}
        self._site_by_camera: dict[str, str] = {}
        self._tasks: dict[str, asyncio.Task[None]] = {}  # camera_id → consumer
        self.zones = ZoneEngine(self.redis, settings)
        self.plugins = PluginManager(settings, self.redis)

    # ── camera discovery ──────────────────────────────────────
    async def _load_cameras(self) -> list[CameraConfig]:
        raw = await self.redis.get(f"cameras:{self.settings.tenant_id}")
        if not raw:
            return []  # supervisor re-checks periodically; no spammy warning
        return [CameraConfig.model_validate(c) for c in json.loads(raw)]

    def _make_source(self, cfg: CameraConfig) -> VideoSource:
        self._site_by_camera[cfg.id] = cfg.site_id
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
    def _infer(self, frame: Frame) -> sv.Detections:
        result = self.model.predict(
            frame.data,
            classes=[PERSON_CLASS],
            conf=self.settings.yolo_conf,
            imgsz=self.settings.yolo_imgsz,
            device=self.settings.analyzer_device,
            verbose=False,
        )[0]
        return sv.Detections.from_ultralytics(result)

    async def _process(self, frame: Frame) -> None:
        loop = asyncio.get_running_loop()
        detections = await loop.run_in_executor(self._infer_pool, self._infer, frame)

        tracker = self._trackers.setdefault(frame.camera_id, sv.ByteTrack())
        tracked = tracker.update_with_detections(detections)

        frame_h, frame_w = frame.data.shape[0], frame.data.shape[1]
        site_id = self._site_by_camera.get(frame.camera_id, "")
        zone_events = []
        track_infos: list[TrackInfo] = []

        for i in range(len(tracked)):
            track_id = tracked.tracker_id[i]
            if track_id is None:
                continue
            x1, y1, x2, y2 = (float(v) for v in tracked.xyxy[i])
            confidence = float(tracked.confidence[i]) if tracked.confidence is not None else 0.0
            class_id = int(tracked.class_id[i]) if tracked.class_id is not None else PERSON_CLASS

            cx = (x1 + x2) / 2.0 / frame_w
            cy = (y1 + y2) / 2.0 / frame_h
            track_infos.append(TrackInfo(
                track_id=int(track_id),
                bbox=(x1, y1, x2, y2),
                center_norm=(cx, cy),
                confidence=confidence,
                zone_ids=frozenset(self.zones.zones_containing(frame.camera_id, cx, cy)),
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
            )
            zone_events.extend(self.zones.process(te))

        if zone_events:
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
        )
        plugin_events = await self.plugins.dispatch(ctx)
        if plugin_events:
            await self.zones.emit(plugin_events)

    # ── per-camera consumer; isolated so one failure stays local
    async def _consume(self, source: VideoSource) -> None:
        try:
            async for frame in source.frames():
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
        bg = [
            asyncio.create_task(self.zones.run_refresh()),
            asyncio.create_task(self._refresh_features()),
            asyncio.create_task(self._camera_supervisor()),
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
            await asyncio.sleep(self.settings.zone_refresh_seconds)

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
