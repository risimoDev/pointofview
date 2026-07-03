from __future__ import annotations

import abc
import asyncio
import logging
import time
from dataclasses import dataclass
from typing import AsyncGenerator

import cv2
import numpy as np

logger = logging.getLogger(__name__)


@dataclass(slots=True)
class Frame:
    camera_id: str
    tenant_id: str
    data: np.ndarray
    ts: float


class VideoSource(abc.ABC):
    def __init__(self, camera_id: str, tenant_id: str, frame_skip: int = 0) -> None:
        self.camera_id = camera_id
        self.tenant_id = tenant_id
        self.frame_skip = max(0, frame_skip)

    def _keep(self, index: int) -> bool:
        # frame_skip=0 → keep all; frame_skip=N → keep every (N+1)-th
        return index % (self.frame_skip + 1) == 0

    @abc.abstractmethod
    def frames(self) -> AsyncGenerator[Frame, None]:
        ...


class RtspPullSource(VideoSource):
    """RTSP pull via OpenCV with exponential-backoff reconnect.

    One dead camera never kills the worker: read errors trigger reconnect
    with backoff 1s → 2s → 4s → … → max_backoff.
    """

    def __init__(
        self,
        camera_id: str,
        tenant_id: str,
        url: str,
        frame_skip: int = 0,
        max_backoff: float = 60.0,
    ) -> None:
        super().__init__(camera_id, tenant_id, frame_skip)
        self.url = url
        self.max_backoff = max_backoff

    def _open(self) -> cv2.VideoCapture:
        cap = cv2.VideoCapture(self.url, cv2.CAP_FFMPEG)
        # keep latency low: drop internal buffering
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        return cap

    async def frames(self) -> AsyncGenerator[Frame, None]:
        loop = asyncio.get_running_loop()
        backoff = 1.0
        while True:
            cap = await loop.run_in_executor(None, self._open)
            if not cap or not cap.isOpened():
                if cap:
                    cap.release()
                logger.warning("camera %s: open failed, retry in %.0fs", self.camera_id, backoff)
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, self.max_backoff)
                continue

            logger.info("camera %s: connected", self.camera_id)
            backoff = 1.0
            index = 0
            try:
                while True:
                    ok, data = await loop.run_in_executor(None, cap.read)
                    if not ok:
                        logger.warning("camera %s: stream dropped", self.camera_id)
                        break
                    index += 1
                    if not self._keep(index):
                        continue
                    yield Frame(self.camera_id, self.tenant_id, data, time.time())
            finally:
                await loop.run_in_executor(None, cap.release)

            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, self.max_backoff)


class FileSource(VideoSource):
    """Local file source for tests. loop=True replays the file endlessly."""

    def __init__(
        self,
        camera_id: str,
        tenant_id: str,
        path: str,
        frame_skip: int = 0,
        loop: bool = True,
    ) -> None:
        super().__init__(camera_id, tenant_id, frame_skip)
        self.path = path
        self.loop = loop

    async def frames(self) -> AsyncGenerator[Frame, None]:
        loop = asyncio.get_running_loop()
        while True:
            cap = await loop.run_in_executor(None, cv2.VideoCapture, self.path)
            if not cap.isOpened():
                cap.release()
                raise RuntimeError(f"camera {self.camera_id}: cannot open file {self.path}")

            fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
            delay = 1.0 / fps
            index = 0
            try:
                while True:
                    ok, data = await loop.run_in_executor(None, cap.read)
                    if not ok:
                        break
                    index += 1
                    if not self._keep(index):
                        continue
                    yield Frame(self.camera_id, self.tenant_id, data, time.time())
                    await asyncio.sleep(delay)  # pace to source fps
            finally:
                await loop.run_in_executor(None, cap.release)

            if not self.loop:
                return
