#!/usr/bin/env bash
#
# Builds a complete, self-contained "full edition" tarball from an already-built `grist`
# image and publishes it to an S3 bucket, so a grist-oss installation can download and
# use it at runtime in place of the built-in OSS build.
# (See app/server/lib/bootstrapFullEdition.ts.)
#
# The tarball is a subset of the `grist` image app, per-arch, containing:
#   grist/        - the image's /grist
#   node_modules/ - the image's root /node_modules
#
# Tarballs are pushed to the following S3 path:
#   ${PREFIX}/${CHANNEL}/${YYYYMMDD}.${NNNN}/grist-${LABEL}-${ARCH}.tar.gz
#
#   PREFIX   - S3 bucket prefix. See GRIST_STATIC_S3_PREFIX below.
#   CHANNEL  - Build channel (e.g. latest, release). See CHANNEL below.
#   YYYYMMDD - UTC build date.
#   NNNN     - Zero-padded per-day sequence (highest in S3 + 1, per channel + date).
#   LABEL    - Human-friendly label (e.g. v1.7.8, latest-<commit>). See LABEL below.
#   ARCH     - Target architecture. See ARCHES below.
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
#   ARCHES   - space-separated arches to package (default: "amd64 arm64"); must be a
#              subset of what ${IMAGE} contains
#   DRY_RUN  - set to 1 to skip the S3 upload (same as --dry-run)
#   GRIST_STATIC_S3_BUCKET / GRIST_STATIC_S3_PREFIX / GRIST_STATIC_HOST - upload target and
#              public URL base (default: grist-static / grist-full-edition / https://grist-static.com)
#
# Examples:
#   # Build tarball but skip copying to S3
#   IMAGE=gristlabs/grist:latest CHANNEL=latest LABEL=dev buildtools/publish-grist-full-edition.sh --dry-run
#
#   # Build tarball and copy to S3
#   IMAGE=gristlabs/grist:latest CHANNEL=latest LABEL=dev buildtools/publish-grist-full-edition.sh

set -euo pipefail

# DRY_RUN=1 (or the --dry-run flag) builds the tarballs but skips the S3 upload, so a stray
# AWS_ACCESS_KEY_ID can't trigger an accidental publish.
DRY_RUN="${DRY_RUN:-0}"
if [[ "${1:-}" == "--dry-run" ]]; then DRY_RUN=1; shift; fi

: "${IMAGE:?IMAGE is required}"
: "${CHANNEL:?CHANNEL is required (release|latest)}"
: "${LABEL:?LABEL is required}"
ARCHES="${ARCHES:-amd64 arm64}"

BUCKET="${GRIST_STATIC_S3_BUCKET:-grist-static}"
PREFIX="${GRIST_STATIC_S3_PREFIX:-grist-full-edition}"
HOST="${GRIST_STATIC_HOST:-https://grist-static.com}"
DATE="$(date -u +%Y%m%d)"

work="$(mktemp -d)"

sha_of() { sha256sum "$1" | awk '{print $1}'; }

if [[ -z "${AWS_ACCESS_KEY_ID:-}" || -z "${AWS_SECRET_ACCESS_KEY:-}" ]]; then
  echo "AWS credentials are required" >&2
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

declare -A shas
for arch in $ARCHES; do
  stage="$work/$arch"
  mkdir -p "$stage"

  docker create --platform "linux/$arch" --name "grist-full-edition-$arch" "$IMAGE"
  docker cp "grist-full-edition-$arch:/grist" "$stage/grist"
  docker cp "grist-full-edition-$arch:/node_modules" "$stage/node_modules"
  docker rm "grist-full-edition-$arch"

  # Source maps are dev-only.
  find "$stage" -name '*.map' -delete

  # Dangling symlinks are unused at runtime.
  find "$stage" -xtype l -delete

  tmp="$work/$arch.tgz"
  tar czf "$tmp" -C "$stage" .
  shas[$arch]="$(sha_of "$tmp")"
  mv "$tmp" "grist-${LABEL}-${arch}.tar.gz"
done

SEQ="$(allocate_seq)"
DIR="${CHANNEL}/${DATE}.${SEQ}"

if [[ "$DRY_RUN" != 1 ]]; then
  echo "+ Uploading to s3://$BUCKET/$PREFIX/$DIR/"
  for arch in $ARCHES; do
    f="grist-${LABEL}-${arch}.tar.gz"
    aws s3 cp "$f" "s3://$BUCKET/$PREFIX/$DIR/$f"
  done
  echo "+ Uploaded to ${HOST}/${PREFIX}/${DIR}/"

  if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
    {
      for arch in $ARCHES; do
        echo "full_url_${arch}=${HOST}/${PREFIX}/${DIR}/grist-${LABEL}-${arch}.tar.gz"
        echo "full_sha256_${arch}=${shas[$arch]}"
      done
    } >> "$GITHUB_OUTPUT"
  fi
else
  echo "+ Dry run; skipping S3 upload. Built artifacts:"
  ls -1 grist-"${LABEL}"-*.tar.gz
fi

rm -rf "$work"
