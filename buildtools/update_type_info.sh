#!/usr/bin/env bash

set -e

# updates any Foo*-ti.ts files $root that are older than Foo.ts

root=$1
if [[ -z "$root" ]]; then
  echo "Usage: $0 app"
  exit 1
fi

for root in "$@"; do
  for ti in $(find $root/ -iname "*-ti.ts"); do
    root=$(basename $ti -ti.ts)
    dir=$(dirname $ti)
    src="$dir/$root.ts"
    if [ ! -e $src ]; then
      echo "Cannot find src $src for $ti, aborting"
      exit 1
    fi
    if [ $src -nt $ti ]; then
      echo "Updating $ti from $src"
      node_modules/.bin/ts-interface-builder $src
    fi
  done
done
