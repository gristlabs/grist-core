#!/usr/bin/env bash

# This checks out the ext/ directory from the extra repo (e.g.
# grist-ee or grist-desktop) depending on the supplied repo name.

set -e

repo=$1
dir=$(dirname $0)

if [[ "$repo" = "" ]]; then
  echo "+ Please supply a repo to checkout (such as grist-ee)"
  exit 1
fi

ref=$(cat $dir/.$repo-version)

echo "+ Fetching $repo"
git -c advice.detachedHead=false clone --quiet --branch $ref \
    --depth 1 --filter=tree:0 "https://github.com/gristlabs/$repo"
pushd $repo > /dev/null
git sparse-checkout set ext
git checkout
popd > /dev/null

echo "+ Installing as ext directory"
rm -rf ./ext
mv $repo/ext .
rm -rf $repo
