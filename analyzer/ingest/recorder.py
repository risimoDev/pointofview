from __future__ import annotations

import asyncio
import json
import logging
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
import redis.asyncio as aioredis

from analyzer.config import CameraConfig, Settings

logger = logging.getLogger(__name__)

SEGMENT_GLOB = "*.mp4"
NAME_FORMAT = "%Y%m%d_%H%M%S"
# Anything smaller holds no frames — an mp4 header alone is ~1 KB.
MIN_SEGMENT_BYTES = 4096


def _parse_started(path: Path) -> datetime:
    # strftime filename → UTC wall-clock (container TZ must be UTC)
    return datetime.strptime(path.stem, NAME_FORMAT).replace(tzinfo=timezone.utc)


class SegmentRecorder:
    """One ffmpeg `-f segment` process per camera (main stream, -c copy).
    A watcher finalizes each completed segment and POSTs its metadata to
    /internal/segments. ffmpeg death → backoff restart (camera isolated).
    """

    def __init__(self, settings: Settings, cfg: CameraConfig, client: httpx.AsyncClient) -> None:
        self.settings = settings
        self.cfg = cfg
        self.client = client
        self.out_dir = Path(settings.archive_root) / settings.tenant_id / cfg.id
        self._posted: set[str] = set()

    def _cmd(self) -> list[str]:
        pattern = str(self.out_dir / f"{NAME_FORMAT}.mp4")
        if not self.cfg.url_main:
            raise ValueError(f"camera {self.cfg.id}: url_main required for recording")
        # Video only, deliberately.
        #
        # Technically: cameras commonly send G.711 (pcm_alaw) audio, which mp4
        # cannot carry. With `-c copy` ffmpeg fails writing the header and
        # produces NOTHING — no video either. Transcoding to AAC would work but
        # costs CPU on every camera around the clock.
        #
        # Legally: audio recording of people falls under stricter rules than
        # video and is outside the position our contracts and privacy documents
        # are built on (video without biometrics). Recording it by accident,
        # because a camera happened to have a microphone, is a risk taken for
        # nothing — an archive for video analytics has no use for sound.
        return [
            self.settings.ffmpeg_bin, "-nostdin", "-hide_banner", "-loglevel", "error",
            "-rtsp_transport", "tcp", "-i", self.cfg.url_main,
            "-map", "0:v:0", "-an",
            "-c", "copy", "-f", "segment",
            "-segment_time", str(self.settings.segment_seconds),
            "-reset_timestamps", "1", "-strftime", "1", pattern,
        ]

    async def run(self) -> None:
        self.out_dir.mkdir(parents=True, exist_ok=True)
        backoff = 1.0
        while True:
            logger.info("recorder %s: starting ffmpeg", self.cfg.id)
            proc = await asyncio.create_subprocess_exec(
                *self._cmd(),
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.PIPE,
            )
            watcher = asyncio.create_task(self._watch())
            # stderr must be DRAINED, not just piped: ffmpeg writes the reason
            # it failed there, and an unread pipe threw that reason away —
            # "rc=1" alone says nothing and is undiagnosable from the log.
            # Reading concurrently with wait() also avoids a full-buffer stall.
            err_task = asyncio.create_task(proc.stderr.read()) if proc.stderr else None
            rc = await proc.wait()
            watcher.cancel()
            err = ""
            if err_task is not None:
                raw = await err_task
                err = raw.decode("utf-8", "replace").strip().replace("\n", " | ")[:500]
            await self._finalize_all(closing=True)

            logger.warning("recorder %s: ffmpeg exited rc=%s, retry in %.0fs%s",
                           self.cfg.id, rc, backoff, f" — {err}" if err else "")
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, self.settings.max_backoff_seconds)

    async def _watch(self) -> None:
        while True:
            await asyncio.sleep(self.settings.segment_seconds / 5 or 5)
            await self._finalize_all(closing=False)

    async def _finalize_all(self, closing: bool) -> None:
        files = sorted(self.out_dir.glob(SEGMENT_GLOB), key=lambda p: p.name)
        if not files:
            return
        # The newest file is the one ffmpeg is currently writing. It only
        # becomes complete once ffmpeg rotates to the next file. On crash it
        # stays partial, so it must NEVER be posted — always exclude it.
        complete = files[:-1]
        for i, path in enumerate(complete):
            if path.name in self._posted:
                continue
            started = _parse_started(path)
            nxt = files[files.index(path) + 1] if files.index(path) + 1 < len(files) else None
            ended = _parse_started(nxt) if nxt else (
                started + timedelta(seconds=self.settings.segment_seconds)
            )
            await self._post(path, started, ended)
            self._posted.add(path.name)

    async def _post(self, path: Path, started: datetime, ended: datetime) -> None:
        try:
            size = os.path.getsize(path)
        except OSError:
            return
        # A crashing ffmpeg leaves an empty file behind on every retry. Posting
        # those fills archive_segment with rows pointing at nothing, and the
        # timeline then shows coverage where no video exists — worse than an
        # obviously empty archive, because it looks like it works.
        if size < MIN_SEGMENT_BYTES:
            logger.warning("recorder %s: skipping empty segment %s (%d bytes)",
                           self.cfg.id, path.name, size)
            try:
                path.unlink()
            except OSError:
                pass
            return
        payload = {
            "tenant_id": self.settings.tenant_id,
            "camera_id": self.cfg.id,
            "started_at": started.isoformat().replace("+00:00", "Z"),
            "ended_at": ended.isoformat().replace("+00:00", "Z"),
            "file_path": str(path),
            "size_bytes": size,
        }
        try:
            resp = await self.client.post(
                f"{self.settings.internal_api_url}/internal/segments",
                json=payload,
                headers={"x-internal-token": self.settings.internal_token},
            )
            resp.raise_for_status()
        except httpx.HTTPError:
            self._posted.discard(path.name)  # retry next tick
            logger.exception("recorder %s: segment POST failed", self.cfg.id)


async def _load_cameras(redis: aioredis.Redis, tenant_id: str) -> list[CameraConfig]:
    raw = await redis.get(f"cameras:{tenant_id}")
    if not raw:
        return []
    return [CameraConfig.model_validate(c) for c in json.loads(raw)]


async def main_async() -> None:
    settings = Settings()  # type: ignore[call-arg]
    logging.basicConfig(
        level=settings.log_level,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    redis = aioredis.from_url(settings.redis_url, decode_responses=True)
    cameras = [c for c in await _load_cameras(redis, settings.tenant_id) if c.url_main]
    if not cameras:
        logger.warning("recorder: no cameras with url_main")
        return

    async with httpx.AsyncClient(timeout=10.0) as client:
        recorders = [SegmentRecorder(settings, c, client) for c in cameras]
        await asyncio.gather(*(r.run() for r in recorders))


def main() -> None:
    try:
        asyncio.run(main_async())
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
