from __future__ import annotations

import json
import logging
import time
import uuid
from base64 import b64decode, b64encode
from dataclasses import dataclass, field
from typing import Any

import cv2
import httpx
import numpy as np
import redis.asyncio as aioredis

from analyzer.config import Settings
from analyzer.reid.embedding import cosine, make_embedder
from analyzer.reid.face import FaceEngine

logger = logging.getLogger(__name__)

EMA_ALPHA = 0.3           # smoothing of a track's rolling embedding
GALLERY_KEY = "reid:gallery:{site_id}"   # hash gid -> json {emb, last_seen}
# staff clothing refs: hash gid -> json {embs: [[...]], name} (API-managed;
# legacy single-{emb} payloads still accepted)
STAFF_KEY = "reid:staff:{tenant_id}"
# staff face refs: hash gid -> json {embs: [[...]], photos, failed}
FACE_STAFF_KEY = "face:staff:{tenant_id}"
FACE_ENROLL_KEY = "face_enroll:{tenant_id}"  # list of {gid, jpeg_b64}
MAX_STAFF_EMBS = 8
MAX_FACE_EMBS = 10


@dataclass(slots=True)
class IdentityResult:
    global_id: str | None
    staff: bool
    # reid is on but the track hasn't earned an identity yet (probation /
    # low-quality crops) — consumers must not count it as a distinct person
    pending: bool = False


@dataclass(slots=True)
class _TrackState:
    emb: np.ndarray | None = None
    gid: str | None = None
    staff: bool = False
    last_match: float = 0.0
    last_seen: float = 0.0
    first_seen: float = 0.0
    samples: int = 0  # accepted (quality-gated) embedding samples
    last_face_try: float = 0.0


@dataclass(slots=True)
class _GalleryEntry:
    emb: np.ndarray
    last_seen: float
    dirty: bool = True  # needs write-back to Redis


@dataclass(slots=True)
class _PendingCrop:
    site_id: str
    gid: str
    jpeg: bytes
    created: float = field(default_factory=time.time)


class IdentityManager:
    """Cross-camera person identity for one tenant.

    Per-site gallery of appearance embeddings lives in Redis so the dashboard
    («Люди») and restarts share it. Staff embeddings are a separate persistent
    hash written by the API; any track matching a staff embedding is flagged
    `staff` for its whole lifetime — plugins/zone engine then skip visitor
    counting and visitor alerts for it.
    """

    feature_id = "reid"

    def __init__(self, settings: Settings, redis: aioredis.Redis) -> None:
        self.settings = settings
        self.redis = redis
        self.embedder = make_embedder()
        self.face = FaceEngine(settings)
        self.enabled = False
        self._cfg: dict[str, Any] = {}
        self._tracks: dict[str, _TrackState] = {}          # "{cam}:{tid}"
        self._gallery: dict[str, dict[str, _GalleryEntry]] = {}   # site -> gid -> entry
        self._staff: dict[str, list[np.ndarray]] = {}      # gid -> clothing embs
        self._face_staff: dict[str, list[np.ndarray]] = {}  # gid -> face embs
        self._gallery_loaded: set[str] = set()
        self._pending_crops: list[_PendingCrop] = []

    # ── config / periodic sync ────────────────────────────────
    def _f(self, key: str, default: float) -> float:
        v = self._cfg.get(key, default)
        try:
            return float(v)
        except (TypeError, ValueError):
            return default

    async def refresh(self) -> None:
        """Re-read feature flag/config + staff gallery. Called every ~30s."""
        raw = await self.redis.get(f"features:{self.settings.tenant_id}")
        feats: dict[str, Any] = json.loads(raw) if raw else {}
        if self.feature_id in self.settings.enabled_plugin_ids():
            feats.setdefault(self.feature_id, {"enabled": True, "config": {}})
        feat = feats.get(self.feature_id) or {}
        self.enabled = bool(feat.get("enabled"))
        self._cfg = feat.get("config") or {}

        if not self.enabled:
            return
        staff_raw = await self.redis.hgetall(STAFF_KEY.format(tenant_id=self.settings.tenant_id))
        staff: dict[str, list[np.ndarray]] = {}
        for gid, payload in staff_raw.items():
            try:
                d = json.loads(payload)
                raw_embs = d.get("embs") or ([d["emb"]] if d.get("emb") else [])
                embs = [np.asarray(e, dtype=np.float32) for e in raw_embs]
                embs = [e for e in embs if e.shape[0] == self.embedder.dim]
                if embs:
                    staff[gid] = embs
            except (KeyError, ValueError, TypeError, json.JSONDecodeError):
                continue
        self._staff = staff

        if self.face.ready:
            face_raw = await self.redis.hgetall(
                FACE_STAFF_KEY.format(tenant_id=self.settings.tenant_id))
            face_staff: dict[str, list[np.ndarray]] = {}
            for gid, payload in face_raw.items():
                try:
                    embs = [np.asarray(e, dtype=np.float32)
                            for e in (json.loads(payload).get("embs") or [])]
                    if embs:
                        face_staff[gid] = embs
                except (ValueError, TypeError, json.JSONDecodeError):
                    continue
            self._face_staff = face_staff

    async def ensure_site(self, site_id: str) -> None:
        """Lazy-load the site gallery once (no-op afterwards)."""
        if self.enabled:
            await self._load_gallery(site_id)

    async def _load_gallery(self, site_id: str) -> None:
        if site_id in self._gallery_loaded:
            return
        self._gallery_loaded.add(site_id)
        entries: dict[str, _GalleryEntry] = {}
        raw = await self.redis.hgetall(GALLERY_KEY.format(site_id=site_id))
        for gid, payload in raw.items():
            try:
                d = json.loads(payload)
                emb = np.asarray(d["emb"], dtype=np.float32)
                if emb.shape[0] == self.embedder.dim:
                    entries[gid] = _GalleryEntry(emb=emb, last_seen=float(d.get("last_seen", 0)), dirty=False)
            except (KeyError, ValueError, json.JSONDecodeError):
                continue
        self._gallery[site_id] = entries

    async def sync(self) -> None:
        """Write dirty gallery entries back to Redis + expire stale ones.
        Also uploads pending identity crops through the internal API."""
        if not self.enabled:
            return
        ttl = self._f("gallery_ttl_hours", 12.0) * 3600.0
        now = time.time()
        for site_id, entries in self._gallery.items():
            key = GALLERY_KEY.format(site_id=site_id)
            stale = [gid for gid, e in entries.items() if now - e.last_seen > ttl]
            if stale:
                for gid in stale:
                    del entries[gid]
                await self.redis.hdel(key, *stale)
            dirty = {gid: e for gid, e in entries.items() if e.dirty}
            if dirty:
                mapping = {
                    gid: json.dumps({"emb": e.emb.tolist(), "last_seen": e.last_seen})
                    for gid, e in dirty.items()
                }
                await self.redis.hset(key, mapping=mapping)
                for e in dirty.values():
                    e.dirty = False
            # adopt deletions made by the API («Люди»: удаление/поглощение
            # дублей в сотрудника) so stale copies don't keep matching here
            redis_gids = set(await self.redis.hkeys(key))
            for gid in [g for g, e in entries.items() if g not in redis_gids and not e.dirty]:
                del entries[gid]

        # forget tracks that vanished
        lost = self.settings.track_lost_seconds * 3
        for tkey in [k for k, s in self._tracks.items() if now - s.last_seen > lost]:
            del self._tracks[tkey]

        await self._flush_crops()
        if self.face.ready:
            await self._process_face_enrollments()

    async def _process_face_enrollments(self) -> None:
        """Photos queued by the API («Люди»: фото сотрудника / кроп с камеры)
        → face embeddings in the persistent staff face gallery."""
        key = FACE_ENROLL_KEY.format(tenant_id=self.settings.tenant_id)
        fkey = FACE_STAFF_KEY.format(tenant_id=self.settings.tenant_id)
        for _ in range(5):  # bounded batch per sync tick
            raw = await self.redis.lpop(key)
            if not raw:
                return
            try:
                d = json.loads(raw)
                gid = str(d["gid"])
                arr = np.frombuffer(b64decode(d["jpeg_b64"]), dtype=np.uint8)
                img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
                emb = self.face.embed_largest(img) if img is not None else None

                cur_raw = await self.redis.hget(fkey, gid)
                cur: dict[str, Any] = json.loads(cur_raw) if cur_raw else {}
                embs: list[Any] = list(cur.get("embs") or [])
                photos = int(cur.get("photos") or 0) + 1
                failed = int(cur.get("failed") or 0)
                if emb is None:
                    failed += 1
                    logger.warning("face enroll %s: no usable face in photo", gid)
                else:
                    embs.append(emb.tolist())
                    embs = embs[-MAX_FACE_EMBS:]
                    self._face_staff[gid] = [np.asarray(e, dtype=np.float32) for e in embs]
                    logger.info("face enroll %s: %d sample(s) total", gid, len(embs))
                await self.redis.hset(fkey, gid, json.dumps(
                    {"embs": embs, "photos": photos, "failed": failed}))
            except Exception:  # noqa: BLE001 — one bad photo must not wedge the queue
                logger.exception("face enrollment item failed")

    async def _flush_crops(self) -> None:
        if not self._pending_crops or not self.settings.internal_api_url:
            self._pending_crops = self._pending_crops[-20:]
            return
        crops, self._pending_crops = self._pending_crops, []
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                for c in crops:
                    await client.post(
                        f"{self.settings.internal_api_url}/internal/reid/crop",
                        headers={"x-internal-token": self.settings.internal_token},
                        json={
                            "tenant_id": self.settings.tenant_id,
                            "site_id": c.site_id,
                            "gid": c.gid,
                            "jpeg_b64": b64encode(c.jpeg).decode(),
                        },
                    )
        except httpx.HTTPError:
            # API down: keep the newest few and retry next sync
            self._pending_crops = (crops + self._pending_crops)[-20:]

    # ── per-frame resolution ──────────────────────────────────
    def resolve(
        self,
        camera_id: str,
        site_id: str,
        track_id: int,
        frame: np.ndarray,
        bbox: tuple[float, float, float, float],
        ts: float,
        confidence: float = 1.0,
    ) -> IdentityResult:
        if not self.enabled:
            return IdentityResult(global_id=None, staff=False)

        tkey = f"{camera_id}:{track_id}"
        state = self._tracks.setdefault(tkey, _TrackState())
        if state.first_seen == 0.0:
            state.first_seen = ts
        state.last_seen = ts

        def _res() -> IdentityResult:
            return IdentityResult(
                global_id=state.gid, staff=state.staff, pending=state.gid is None,
            )

        if ts - state.last_match < self._f("match_interval_seconds", 2.0):
            return _res()
        state.last_match = ts

        # quality gates: weak detections and partial/occluded crops poison the
        # rolling embedding and used to mint phantom "new visitors"
        if confidence < self._f("min_confidence", 0.5):
            return _res()
        crop = self._crop(frame, bbox)
        if crop is None:
            return _res()

        emb = self.embedder(crop)
        state.samples += 1
        if state.emb is None:
            state.emb = emb
        else:
            mixed = (1 - EMA_ALPHA) * state.emb + EMA_ALPHA * emb
            norm = float(np.linalg.norm(mixed))
            state.emb = mixed / norm if norm > 0 else mixed

        # staff match is sticky for the whole track. Clothing refs first
        # (cheap, several samples per person), then the face check on
        # close-up crops — it survives a change of clothes.
        if not state.staff:
            staff_thr = self._f("staff_threshold", 0.90)
            for gid, sembs in self._staff.items():
                if max(cosine(state.emb, e) for e in sembs) >= staff_thr:
                    state.staff = True
                    state.gid = gid
                    break
        if not state.staff and self.face.ready and self._face_staff \
                and crop.shape[0] >= self._f("face_min_px", 140) \
                and ts - state.last_face_try >= self._f("face_interval_seconds", 3.0):
            state.last_face_try = ts
            femb = self.face.embed_largest(crop)
            if femb is not None:
                face_thr = self._f("face_threshold", 0.36)
                for gid, fembs in self._face_staff.items():
                    if max(cosine(femb, e) for e in fembs) >= face_thr:
                        state.staff = True
                        state.gid = gid
                        break
        if state.staff:
            return IdentityResult(global_id=state.gid, staff=True)

        entries = self._gallery.setdefault(site_id, {})
        thr = self._f("match_threshold", 0.88)
        best_gid, best_sim = None, thr
        for gid, entry in entries.items():
            sim = cosine(state.emb, entry.emb)
            if sim >= best_sim:
                best_gid, best_sim = gid, sim

        if best_gid is not None:
            entry = entries[best_gid]
            mixed = (1 - EMA_ALPHA) * entry.emb + EMA_ALPHA * state.emb
            norm = float(np.linalg.norm(mixed))
            entry.emb = mixed / norm if norm > 0 else mixed
            entry.last_seen = ts
            entry.dirty = True
            state.gid = best_gid
            return IdentityResult(global_id=best_gid, staff=False)

        # New person — only from a mature track with several good samples, so a
        # flickering/fragmented track can't register a person per fragment.
        if state.samples < int(self._f("min_samples", 3)) \
                or ts - state.first_seen < self._f("min_track_age_seconds", 3.0):
            return _res()
        # The color-histogram embedder is blind on near-grayscale (night/IR)
        # frames: every re-entry would look "new". Don't mint identities from
        # colorless crops — the ONNX (OSNet) embedder has no such limit.
        if getattr(self.embedder, "color_based", False) \
                and self._mean_saturation(crop) < self._f("min_saturation", 25.0):
            return _res()

        if len(entries) >= int(self._f("max_gallery", 500)):
            return _res()
        gid = uuid.uuid4().hex[:12]
        entries[gid] = _GalleryEntry(emb=state.emb.copy(), last_seen=ts)
        state.gid = gid
        ok, jpeg = cv2.imencode(".jpg", crop, [cv2.IMWRITE_JPEG_QUALITY, 85])
        if ok:
            self._pending_crops.append(_PendingCrop(site_id=site_id, gid=gid, jpeg=jpeg.tobytes()))
        return IdentityResult(global_id=gid, staff=False)

    def _crop(self, frame: np.ndarray, bbox: tuple[float, float, float, float]) -> np.ndarray | None:
        h, w = frame.shape[0], frame.shape[1]
        x1 = max(0, int(bbox[0])); y1 = max(0, int(bbox[1]))
        x2 = min(w, int(bbox[2])); y2 = min(h, int(bbox[3]))
        cw, ch = x2 - x1, y2 - y1
        min_px = int(self._f("min_crop_px", 64))
        if cw < min_px or ch < min_px:
            return None
        # a standing person is tall; wide/square boxes are merges or partials
        aspect = ch / cw if cw > 0 else 0.0
        if not (1.2 <= aspect <= 4.5):
            return None
        return frame[y1:y2, x1:x2]

    @staticmethod
    def _mean_saturation(crop_bgr: np.ndarray) -> float:
        hsv = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2HSV)
        return float(hsv[:, :, 1].mean())
