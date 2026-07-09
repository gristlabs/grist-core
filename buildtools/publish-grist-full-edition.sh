#!/usr/bin/env bash
#
# Builds the full edition extensions from an already-built `grist` image and publishes them to
# an S3 bucket in a compressed tarball, so an extension-free installation (e.g. `grist-oss` image)
# can download them at runtime and layer the full edition onto its own local build.
# (See app/server/lib/bootstrapFullEdition.ts.)
#
# The tarball contains:
#   ext/               - compiled extension code (from the image's /grist/_build/ext)
#   ext/assets/        - extension assets (from the image's /grist/ext/assets)
#   ext/node_modules/  - extension dependencies (from the image's root /node_modules)
#   static/            - static assets and webpack bundles (from /grist/static)
#
# The tarball is pushed to the following S3 path:
#   ${PREFIX}/${CHANNEL}/${YYYYMMDD}.${NNNN}/ext-${LABEL}.tar.gz
#
#   PREFIX   - S3 bucket prefix. See GRIST_STATIC_S3_PREFIX below.
#   CHANNEL  - Build channel (e.g. latest, release). See CHANNEL below.
#   YYYYMMDD - UTC build date.
#   NNNN     - Zero-padded per-day sequence (highest in S3 + 1, per channel + date).
#   LABEL    - Human-friendly label (e.g. v1.7.8, latest-<commit>). See LABEL below.
#
# Arguments:
#   --dry-run - skip the S3 upload (same as DRY_RUN=1)
#
# Required env variables:
#   IMAGE    - the pushed grist image reference (e.g. gristlabs/grist:stable)
#   CHANNEL  - release | latest (selects the prefix)
#   LABEL    - human-friendly name embedded in the filename (release: the tag, e.g.
#              v1.7.8, latest: latest-<commit>)
#   AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_DEFAULT_REGION - S3 credentials + region
#
# Optional env variables:
#   DRY_RUN  - set to 1 to skip the S3 upload (same as --dry-run)
#   GRIST_STATIC_S3_BUCKET / GRIST_STATIC_S3_PREFIX / GRIST_STATIC_HOST - upload target and
#              public URL base (default: grist-static / grist-full-edition / https://grist-static.com)
#
# Examples:
#   # Build the extensions but skip copying to S3
#   IMAGE=gristlabs/grist:latest CHANNEL=latest LABEL=dev buildtools/publish-grist-full-edition.sh --dry-run
#
#   # Build the extensions and copy to S3
#   IMAGE=gristlabs/grist:latest CHANNEL=latest LABEL=dev buildtools/publish-grist-full-edition.sh

set -euo pipefail

# DRY_RUN=1 (or the --dry-run flag) builds the extensions but skips the S3 upload, so a stray
# AWS_ACCESS_KEY_ID can't trigger an accidental publish.
DRY_RUN="${DRY_RUN:-0}"
if [[ "${1:-}" == "--dry-run" ]]; then DRY_RUN=1; shift; fi

: "${IMAGE:?IMAGE is required}"
: "${CHANNEL:?CHANNEL is required (release|latest)}"
: "${LABEL:?LABEL is required}"

BUCKET="${GRIST_STATIC_S3_BUCKET:-grist-static}"
PREFIX="${GRIST_STATIC_S3_PREFIX:-grist-full-edition}"
HOST="${GRIST_STATIC_HOST:-https://grist-static.com}"
DATE="$(date -u +%Y%m%d)"

sha_of() { sha256sum "$1" | awk '{print $1}'; }

if [[ "$DRY_RUN" != 1 && ( -z "${AWS_ACCESS_KEY_ID:-}" || -z "${AWS_SECRET_ACCESS_KEY:-}" ) ]]; then
  echo "AWS credentials are required (or pass --dry-run)" >&2
  exit 1
fi

allocate_seq() {
  local listing last
  if ! listing="$(aws s3 ls "s3://${BUCKET}/${PREFIX}/${CHANNEL}/" 2>&1)"; then
    if [[ -n "$listing" ]]; then
      echo "aws s3 ls failed: $listing" >&2
      return 1
    fi
  fi
  last="$(grep -oE "${DATE}\.[0-9]+" <<< "$listing" | sed -E 's/.*\.//' | sort -n | tail -1 || true)"
  printf '%04d' "$(( 10#${last:-0} + 1 ))"
}

work="$(mktemp -d)"
container="grist-full-edition-$$"
cleanup() { rm -rf "$work"; docker rm -f "$container" >/dev/null 2>&1 || true; }
trap cleanup EXIT

stage="$work/ext"
mkdir -p "$stage"

docker create --name "$container" "$IMAGE" >/dev/null
docker cp "$container:/grist/_build/ext" "$stage/ext"
docker cp "$container:/node_modules" "$stage/ext/node_modules"
docker cp "$container:/grist/static" "$stage/static"
docker cp "$container:/grist/ext/assets" "$stage/ext/assets" 2>/dev/null \
  || echo "+ note: no /grist/ext/assets in image; skipping"

buildtools/prune-runtime-modules.sh "$stage/ext/node_modules"

# Source maps are dev-only.
find "$stage" -name '*.map' -delete

# Dangling symlinks are unused at runtime.
find "$stage" -xtype l -delete

tarball="ext-${LABEL}.tar.gz"
tar czf "$tarball" -C "$stage" .
SHA="$(sha_of "$tarball")"

if [[ "$DRY_RUN" == 1 ]]; then
  echo "+ Dry run; skipping S3 upload. Built extensions:"
  ls -l "$tarball"
  echo "+ sha256=${SHA}"
  exit 0
fi

SEQ="$(allocate_seq)"
DIR="${CHANNEL}/${DATE}.${SEQ}"

echo "+ Uploading to s3://$BUCKET/$PREFIX/$DIR/$tarball"
aws s3 cp "$tarball" "s3://$BUCKET/$PREFIX/$DIR/$tarball"
URL="${HOST}/${PREFIX}/${DIR}/${tarball}"
echo "+ Published ${URL}"

if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  {
    echo "full_url=${URL}"
    echo "full_sha256=${SHA}"
  } >> "$GITHUB_OUTPUT"
fi
