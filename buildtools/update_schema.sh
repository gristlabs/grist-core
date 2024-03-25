#!/usr/bin/env bash

# Regenerates typescript files with schema and sql for grist documents.
# This needs to run whenever the document schema is changed in the data
# engine, maintained in python code. It propagates the schema information
# to a typescript file, and updates SQL code for initializing new documents.
#
# To preview what it will do, call as:
#   buildtools/update_schema.sh schema.ts sql.ts
# This will put schema.ts and sql.ts files in your working directory.
# Run without any arguments to modify application files.
#   buildtools/update_schema.sh
# (you can see the differences with git diff if in a git repository).

set -e

schema_ts=$1
sql_ts=$2
if [[ -z "$schema_ts" ]]; then
  # Default to regenerating regular suspects.
  schema_ts=app/common/schema.ts
  sql_ts=app/server/lib/initialDocSql.ts
fi
if [[ -z "$sql_ts" ]]; then
  echo "Need both a schema and sql target"
  exit 1
fi

# Prepare new version of schema file.
# Define custom python path locally, do not let it bleed over to node, since it
# could interfere with sandbox operation.
if [[ -e sandbox_venv3/bin/python ]]; then
  # Use our virtual env if available.
  PYTHON=sandbox_venv3/bin/python
else
  # Fall back on system.
  PYTHON=python
fi
PYTHONPATH=sandbox/grist:sandbox/thirdparty $PYTHON -B sandbox/gen_js_schema.py > $schema_ts.tmp

# Prepare new version of sql file.
export NODE_PATH=_build:_build/core:_build/stubs:_build/ext
BUILD=$(test -e _build/core && echo "_build/core" || echo "_build")
node $BUILD/app/server/generateInitialDocSql.js $sql_ts.tmpdoc > $sql_ts.tmp

rm $sql_ts.tmpdoc.grist
mv $schema_ts.tmp $schema_ts
mv $sql_ts.tmp $sql_ts
