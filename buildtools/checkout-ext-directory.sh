#!/usr/bin/env bash

# This checks out the ext/ directory from the extra repo (e.g.
# grist-ee or grist-desktop) depending on the supplied repo name.
#
# For grist-ee, there is some special behavior. If the git clone
# fails, we now check for a pre-built ext/ tarball from
# https://grist-static.com/ext/. In future, this will become the
# default.

set -e

repo=$1
dir=$(dirname $0)

if [[ "$repo" = "" ]]; then
  echo "+ Please supply a repo to checkout (such as grist-ee)"
  exit 1
fi

ref=$(cat $dir/.$repo-version)

# Try git clone first.
if git -c advice.detachedHead=false clone --quiet --branch $ref \
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
elif [[ "$repo" = "grist-ee" ]]; then
  # Check for a pre-built tarball.
  TARBALL="ext-built-${ref}.tar.gz"
  URL="https://grist-static.com/ext/$TARBALL"

  echo "+ git clone failed, trying $URL"
  curl -fsSL "$URL" -o "$TARBALL"
  rm -rf ./ext
  tar xzf "$TARBALL"
  rm -f "$TARBALL"
  echo "+ Installed pre-built ext ($ref)"
else
  echo "+ Failed to fetch $repo"
  exit 1
fi
