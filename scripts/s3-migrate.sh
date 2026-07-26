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

# .env.prod defines MINIO_ROOT_USER/PASSWORD; MINIO_ACCESS_KEY/SECRET_KEY are
# the dev-file names and do not exist here. Accept either, fail if neither.
S3_KEY="${MINIO_ROOT_USER:-${MINIO_ACCESS_KEY:-}}"
S3_SECRET="${MINIO_ROOT_PASSWORD:-${MINIO_SECRET_KEY:-}}"
[[ -n "$S3_KEY" && -n "$S3_SECRET" ]] || {
  err "no S3 credentials in $ENV_FILE (need MINIO_ROOT_USER/MINIO_ROOT_PASSWORD)"; exit 1; }

SRC_ENDPOINT="${SRC_ENDPOINT:-http://minio:9000}"
DST_ENDPOINT="${DST_ENDPOINT:-http://seaweedfs:8333}"
BUCKETS=("${MINIO_BUCKET_CLIPS:-clips}" "${MINIO_BUCKET_SNAPSHOTS:-snapshots}")
NETWORK="${COMPOSE_NETWORK:-viziai_default}"
RCLONE_IMAGE="rclone/rclone:1.68"
# Objects the destination may lag behind by while the source is live.
DRIFT="${DRIFT:-200}"

VERIFY_ONLY=0
[[ "${1:-}" == "--verify" ]] && VERIFY_ONLY=1

rclone_run() {
  docker run --rm --network "$NETWORK" \
    -e RCLONE_CONFIG_SRC_TYPE=s3 \
    -e RCLONE_CONFIG_SRC_PROVIDER=Minio \
    -e RCLONE_CONFIG_SRC_ENDPOINT="$SRC_ENDPOINT" \
    -e RCLONE_CONFIG_SRC_ACCESS_KEY_ID="$S3_KEY" \
    -e RCLONE_CONFIG_SRC_SECRET_ACCESS_KEY="$S3_SECRET" \
    -e RCLONE_CONFIG_DST_TYPE=s3 \
    -e RCLONE_CONFIG_DST_PROVIDER=Other \
    -e RCLONE_CONFIG_DST_ENDPOINT="$DST_ENDPOINT" \
    -e RCLONE_CONFIG_DST_ACCESS_KEY_ID="$S3_KEY" \
    -e RCLONE_CONFIG_DST_SECRET_ACCESS_KEY="$S3_SECRET" \
    "$RCLONE_IMAGE" "$@"
}

count() { # $1 = remote:bucket -> object count on stdout, rclone error on stderr
  # No 2>/dev/null here: hiding the error plus `set -e` made a failed size
  # call kill the script silently right after "verifying".
  local out status
  out="$(rclone_run size "$1" --json 2>&1)" && status=0 || status=$?
  if [[ $status -ne 0 ]]; then
    # An empty source bucket is never created on the destination, and `size`
    # on a bucket that does not exist is an error, not a zero. Report 0.
    if grep -q "directory not found" <<< "$out"; then
      echo 0
      return 0
    fi
    err "rclone size $1 failed:"
    echo "$out" >&2
    return 1
  fi
  sed -n 's/.*"count":\([0-9]*\).*/\1/p' <<< "$out"
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
  s="$(count "src:$b")" || { FAIL=1; continue; }
  d="$(count "dst:$b")" || { FAIL=1; continue; }
  s="${s:-0}"; d="${d:-0}"
  # The source keeps growing while we copy — the analyzer writes snapshots
  # continuously — so exact equality is only reachable with the writers
  # stopped. Small positive drift is expected; the destination being far
  # behind is not.
  delta=$(( s - d ))
  if [[ "$s" -eq 0 && "$d" -eq 0 ]]; then
    warn "  $b: обе стороны пусты (для clips это норма — recorder выключен)"
  elif [[ "$delta" -eq 0 ]]; then
    info "  $b: $s = $d"
  elif [[ "$delta" -gt 0 && "$delta" -le "$DRIFT" ]]; then
    warn "  $b: MinIO $s, SeaweedFS $d — отставание на $delta (запись идёт, это норма)"
  else
    err "  $b: MinIO $s, SeaweedFS $d — расхождение $delta"
    FAIL=1
  fi
done

if [[ "$FAIL" -ne 0 ]]; then
  err "counts differ — do NOT switch MINIO_ENDPOINT yet; re-run this script"
  exit 1
fi
info "проверка пройдена. Перед переключением: остановить писателей
    (api worker-clips worker-alerts worker-ai analyzer), прогнать этот
    скрипт ещё раз до полного совпадения, затем docs/operations/S3-SEAWEEDFS.md"
