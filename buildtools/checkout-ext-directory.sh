#!/usr/bin/env bash

# This checks out the ext/ directory from the extra repo (e.g.
# grist-ee or grist-desktop) depending on the supplied repo name.

set -e

repo=$1
dir=$(dirname $0)
ref=$(cat $dir/.$repo-version)

git clone --branch $ref --depth 1 --filter=tree:0 "https://github.com/gristlabs/$repo"
pushd $repo
git sparse-checkout set ext
git checkout
popd
rm -rf ./ext
mv $repo/ext .
rm -rf $repo
