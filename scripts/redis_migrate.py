#!/usr/bin/env python3
"""Move Redis data to Valkey when the on-disk format can't be reused.

Redis 7.4 writes RDB version 12; Valkey 8 reads at most 11, so the volume
cannot simply be handed over (and DUMP/RESTORE fails for the same reason —
the payload footer carries the source RDB version). This copies the data as
plain commands instead, which are version-independent.

    # 1. with the OLD server still running
    python redis_migrate.py export --url redis://redis:6379 --out /data/keys.json

    # 2. after switching the image and starting on an EMPTY volume
    python redis_migrate.py import --url redis://redis:6379 --in /data/keys.json

Streams and BullMQ keys are skipped on purpose: they are in-flight queues
that both services rebuild by themselves, and copying them half-way would
resurrect stale jobs. Everything else (staff embeddings, galleries, counters,
heatmaps, settings caches) is carried over with its TTL.
"""

from __future__ import annotations

import argparse
import base64
import json
import sys
from typing import Any

SKIP_PREFIXES = ("bull:",)   # BullMQ internals: rebuilt by the workers
SKIP_TYPES = ("stream",)     # track_events / events: transient by design

# Values are raw bytes (JSON, floats, packed embeddings), so everything is
# base64-encoded in the dump file — no encoding guesswork, no lost bytes.
b64 = lambda v: base64.b64encode(v).decode("ascii")
unb64 = lambda s: base64.b64decode(s.encode("ascii"))


def connect(url: str) -> Any:
    import redis

    return redis.from_url(url, decode_responses=False)


def export(url: str, out_path: str) -> int:
    r = connect(url)
    items: list[dict[str, Any]] = []
    skipped_type: dict[str, int] = {}

    for raw_key in r.scan_iter(count=500):
        key = raw_key.decode("utf-8", "replace")
        if key.startswith(SKIP_PREFIXES):
            continue
        ktype = r.type(raw_key).decode()
        if ktype in SKIP_TYPES:
            skipped_type[ktype] = skipped_type.get(ktype, 0) + 1
            continue

        ttl = r.pttl(raw_key)
        entry: dict[str, Any] = {"key": b64(raw_key), "type": ktype}
        if ttl and ttl > 0:
            entry["pttl"] = ttl

        if ktype == "string":
            entry["value"] = b64(r.get(raw_key))
        elif ktype == "hash":
            entry["value"] = [[b64(f), b64(v)] for f, v in r.hgetall(raw_key).items()]
        elif ktype == "list":
            entry["value"] = [b64(v) for v in r.lrange(raw_key, 0, -1)]
        elif ktype == "set":
            entry["value"] = [b64(v) for v in r.smembers(raw_key)]
        elif ktype == "zset":
            entry["value"] = [[b64(m), s] for m, s in r.zrange(raw_key, 0, -1, withscores=True)]
        else:
            skipped_type[ktype] = skipped_type.get(ktype, 0) + 1
            continue
        items.append(entry)

    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump({"items": items}, fh)

    by_type: dict[str, int] = {}
    for it in items:
        by_type[it["type"]] = by_type.get(it["type"], 0) + 1
    print(f"exported {len(items)} keys -> {out_path}")
    print(f"  by type: {by_type}")
    if skipped_type:
        print(f"  skipped (transient): {skipped_type}")
    staff = [it for it in items
             if unb64(it["key"]).decode("utf-8", "replace").startswith(("reid:staff", "face:staff"))]
    print(f"  staff keys carried over: {len(staff)} "
          f"({[unb64(s['key']).decode('utf-8', 'replace') for s in staff]})")
    return 0


def inspect(in_path: str) -> int:
    """What is actually in a dump file — keys decoded, staff highlighted."""
    with open(in_path, encoding="utf-8") as fh:
        items = json.load(fh)["items"]
    by_type: dict[str, int] = {}
    staff: list[str] = []
    for it in items:
        by_type[it["type"]] = by_type.get(it["type"], 0) + 1
        name = unb64(it["key"]).decode("utf-8", "replace")
        if "staff" in name:
            size = len(it.get("value") or [])
            staff.append(f"{name} ({it['type']}, {size} полей)")
    print(f"{in_path}: {len(items)} keys, by type {by_type}")
    print(f"staff keys: {len(staff)}")
    for s in staff:
        print(f"  {s}")
    return 0


def import_(url: str, in_path: str, force: bool) -> int:
    r = connect(url)
    with open(in_path, encoding="utf-8") as fh:
        items = json.load(fh)["items"]

    # Collision check, not a dbsize check: the analyzer starts writing
    # heartbeats (camera_alive:*) seconds after the server comes up, so a
    # plain "target must be empty" rule blocks every realistic import window.
    collisions = [unb64(it["key"]).decode("utf-8", "replace")
                  for it in items if r.exists(unb64(it["key"]))]
    if collisions and not force:
        print(f"refusing to import: {len(collisions)} keys already exist, "
              f"e.g. {collisions[:5]}. Re-run with --force to overwrite them.",
              file=sys.stderr)
        return 1

    pipe = r.pipeline(transaction=False)
    for it in items:
        key, ktype, value = unb64(it["key"]), it["type"], it.get("value")
        if force:
            pipe.delete(key)  # replace, don't merge into a stale value
        if ktype == "string":
            pipe.set(key, unb64(value))
        elif ktype == "hash":
            pipe.hset(key, mapping={unb64(f): unb64(v) for f, v in value})
        elif ktype == "list":
            pipe.rpush(key, *[unb64(v) for v in value])
        elif ktype == "set":
            pipe.sadd(key, *[unb64(v) for v in value])
        elif ktype == "zset":
            pipe.zadd(key, {unb64(m): float(s) for m, s in value})
        if "pttl" in it:
            pipe.pexpire(key, it["pttl"])
    pipe.execute()

    print(f"imported {len(items)} keys, dbsize now {r.dbsize()}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("mode", choices=("export", "import", "inspect"))
    ap.add_argument("--url", default="redis://redis:6379")
    ap.add_argument("--out", default="/data/keys.json")
    ap.add_argument("--in", dest="in_path", default="/data/keys.json")
    ap.add_argument("--force", action="store_true",
                    help="overwrite keys that already exist in the target")
    args = ap.parse_args()
    if args.mode == "export":
        return export(args.url, args.out)
    if args.mode == "inspect":
        return inspect(args.in_path)
    return import_(args.url, args.in_path, args.force)


if __name__ == "__main__":
    raise SystemExit(main())
