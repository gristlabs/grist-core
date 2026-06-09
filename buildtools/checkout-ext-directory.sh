#!/usr/bin/env bash

# This checks out the ext/ directory from the extra repo (e.g.
# grist-ee or grist-desktop) depending on the supplied repo name.
#
# For grist-ee, there is some special behavior. By default we use a
# pre-built ext/ tarball from https://grist-static.com/ext/ and do not
# attempt a git clone at all. Pass --ignore-tarball to skip the tarball
# and use git clone instead.

set -e

repo=""
ignore_tarball=""
for arg in "$@"; do
  case "$arg" in
    --ignore-tarball) ignore_tarball=1 ;;
    *) repo="$arg" ;;
  esac
done

dir=$(dirname $0)

if [[ "$repo" = "" ]]; then
  echo "+ Please supply a repo to checkout (such as grist-ee)"
  exit 1
fi

ref=$(cat $dir/.$repo-version)

# Fetch a pre-built tarball.
fetch_tarball() {
  TARBALL="ext-built-${ref}.tar.gz"
  URL="https://grist-static.com/ext/$TARBALL"

  echo "+ Fetching $URL"
  curl -fsSL "$URL" -o "$TARBALL"
  rm -rf ./ext
  tar xzf "$TARBALL"
  rm -f "$TARBALL"
  echo "+ Installed pre-built ext ($ref)"
}

if [[ "$repo" = "grist-ee" && -z "$ignore_tarball" ]]; then
  # For grist-ee, always use the tarball (and only the tarball).
  fetch_tarball
elif git -c advice.detachedHead=false clone --quiet --branch $ref \
    --depth 1 --filter=tree:0 "https://github.com/gristlabs/$repo" 2>/dev/null; then
  echo "+ Fetched $repo via git"
  pushd $repo > /dev/null
  git sparse-checkout set ext
  git checkout
  popd > /dev/null

  echo "+ Installing as ext directory"
  rm -rf ./ext
  mv $repo/ext .
  rm -rf $repo
else
  echo "+ Failed to fetch $repo"
  exit 1
fi
