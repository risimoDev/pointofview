from __future__ import annotations

import logging
import os

import cv2
import numpy as np

from analyzer.config import Settings

logger = logging.getLogger(__name__)

# Staff-only face matching: OpenCV YuNet (detector) + SFace (128-d embedding),
# both tiny CPU models bundled into the image at build time. Visitors are never
# matched by face — clothing embeddings only (no visitor biometrics by design).

_MIN_FACE_PX = 20  # smaller detections are unreliable → skip


class FaceEngine:
    def __init__(self, settings: Settings) -> None:
        self._det_path = settings.face_detect_onnx
        self._rec_path = settings.face_recog_onnx
        self._det: cv2.FaceDetectorYN | None = None
        self._rec: cv2.FaceRecognizerSF | None = None
        self.ready = self._present(self._det_path) and self._present(self._rec_path)
        if not self.ready:
            logger.info("face models not found — staff face-id disabled")

    @staticmethod
    def _present(path: str) -> bool:
        try:
            # git-lfs pointer files are ~130 bytes; a real model is way bigger
            return os.path.isfile(path) and os.path.getsize(path) > 100_000
        except OSError:
            return False

    def _ensure(self) -> bool:
        if self._det is not None and self._rec is not None:
            return True
        try:
            self._det = cv2.FaceDetectorYN.create(self._det_path, "", (320, 320), 0.7, 0.3, 500)
            self._rec = cv2.FaceRecognizerSF.create(self._rec_path, "")
            return True
        except Exception:  # noqa: BLE001 — bad model file must not kill the worker
            logger.exception("face models failed to load — staff face-id disabled")
            self.ready = False
            return False

    def embed_largest(self, bgr: np.ndarray) -> np.ndarray | None:
        """L2-normalized embedding of the largest face in the image, or None."""
        if not self.ready or not self._ensure():
            return None
        h, w = bgr.shape[:2]
        if h < 40 or w < 40:
            return None
        try:
            assert self._det is not None and self._rec is not None
            self._det.setInputSize((w, h))
            _, faces = self._det.detect(bgr)
            if faces is None or len(faces) == 0:
                return None
            face = max(faces, key=lambda f: float(f[2]) * float(f[3]))
            if face[2] < _MIN_FACE_PX or face[3] < _MIN_FACE_PX:
                return None
            aligned = self._rec.alignCrop(bgr, face)
            feat = np.asarray(self._rec.feature(aligned), dtype=np.float32).flatten()
            norm = float(np.linalg.norm(feat))
            return feat / norm if norm > 0 else None
        except Exception:  # noqa: BLE001
            logger.exception("face embedding failed")
            return None
