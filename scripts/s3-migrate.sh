#!/usr/bin/env bash
# Copy S3 objects from MinIO to SeaweedFS and verify the counts match.
#
# Both stores must be running: SeaweedFS is added to the compose file on its
# own port precisely so the copy happens with nothing switched over yet.
# Idempotent — rclone sync only transfers what is missing, so it can be run
# again right before the cutover to pick up whatever accumulated meanwhile.
#
#   ./scripts/s3-migrate.sh            # copy, then verify
#   ./scripts/s3-migrate.sh --verify   # verify only, no copying
set -euo pipefail

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; NC='\033[0m'
info() { echo -e "${GREEN}[+]${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }
err()  { echo -e "${RED}[x]${NC} $*" >&2; }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

ENV_FILE=infra/.env.prod
[[ -f "$ENV_FILE" ]] || { err "$ENV_FILE not found"; exit 1; }
set -a; source "$ENV_FILE"; set +a

SRC_ENDPOINT="${SRC_ENDPOINT:-http://minio:9000}"
DST_ENDPOINT="${DST_ENDPOINT:-http://seaweedfs:8333}"
BUCKETS=("${MINIO_BUCKET_CLIPS:-clips}" "${MINIO_BUCKET_SNAPSHOTS:-snapshots}")
NETWORK="${COMPOSE_NETWORK:-viziai_default}"
RCLONE_IMAGE="rclone/rclone:1.68"

VERIFY_ONLY=0
[[ "${1:-}" == "--verify" ]] && VERIFY_ONLY=1

rclone_run() {
  docker run --rm --network "$NETWORK" \
    -e RCLONE_CONFIG_SRC_TYPE=s3 \
    -e RCLONE_CONFIG_SRC_PROVIDER=Minio \
    -e RCLONE_CONFIG_SRC_ENDPOINT="$SRC_ENDPOINT" \
    -e RCLONE_CONFIG_SRC_ACCESS_KEY_ID="$MINIO_ACCESS_KEY" \
    -e RCLONE_CONFIG_SRC_SECRET_ACCESS_KEY="$MINIO_SECRET_KEY" \
    -e RCLONE_CONFIG_DST_TYPE=s3 \
    -e RCLONE_CONFIG_DST_PROVIDER=Other \
    -e RCLONE_CONFIG_DST_ENDPOINT="$DST_ENDPOINT" \
    -e RCLONE_CONFIG_DST_ACCESS_KEY_ID="$MINIO_ACCESS_KEY" \
    -e RCLONE_CONFIG_DST_SECRET_ACCESS_KEY="$MINIO_SECRET_KEY" \
    "$RCLONE_IMAGE" "$@"
}

count() { # $1 = remote:bucket
  rclone_run size "$1" --json 2>/dev/null | sed -n 's/.*"count":\([0-9]*\).*/\1/p'
}

if [[ "$VERIFY_ONLY" -eq 0 ]]; then
  for b in "${BUCKETS[@]}"; do
    info "copying $b …"
    rclone_run sync "src:$b" "dst:$b" --transfers 8 --checkers 16 --stats 10s --stats-one-line
  done
fi

info "verifying"
FAIL=0
for b in "${BUCKETS[@]}"; do
  s="$(count "src:$b")"; d="$(count "dst:$b")"
  s="${s:-0}"; d="${d:-0}"
  if [[ "$s" == "$d" ]]; then
    info "  $b: $s = $d"
  else
    err "  $b: MinIO $s, SeaweedFS $d — расхождение"
    FAIL=1
  fi
done

if [[ "$FAIL" -ne 0 ]]; then
  err "counts differ — do NOT switch MINIO_ENDPOINT yet; re-run this script"
  exit 1
fi
info "objects match. Cutover steps: docs/operations/S3-SEAWEEDFS.md"
