#!/usr/bin/env bash

# Postinstall hook that sets up extensions in ext/ when the full edition of
# Grist is to be installed. The edition is determined by consulting the
# following sources in the order shown:
#  1. GRIST_EDITION env var
#  2. grist-edition file
#  3. "full" (default)
#
# The installed edition is written to grist-edition.
#
# Set GRIST_SKIP_EXT_AUTOSETUP=1 to skip this hook (e.g. for Docker, grist-desktop,
# and grist-static builds).

set -e

if [[ "${GRIST_SKIP_EXT_AUTOSETUP:-}" == "1" ]]; then
  echo "+ Extensions supplied externally; skipping ext auto-setup."
  exit 0
fi

EDITION="${GRIST_EDITION:-}"
if [[ -z "$EDITION" && -e grist-edition ]]; then
  EDITION="$(cat grist-edition)"
fi
if [[ -z "$EDITION" ]]; then
  echo "+ No edition selected; defaulting to full edition."
  echo "+ Downloading extensions for full Grist. Run 'yarn run set-community-edition' to skip."
  EDITION="full"
fi
if [[ "$EDITION" != "community" && "$EDITION" != "full" ]]; then
  echo "ERROR: invalid Grist edition '$EDITION' (expected 'community' or 'full')." >&2
  echo "Check the GRIST_EDITION environment variable or the grist-edition file." >&2
  exit 1
fi
echo "$EDITION" > grist-edition

if [[ "$EDITION" == "full" ]]; then
  exec buildtools/prepare_ee.sh
fi

# Community edition: remove any extensions (and their compiled output) left
# over from a full install, since builds include ext/ whenever it is present.
rm -rf ext _build/ext
echo "+ Grist edition: $EDITION — skipping extensions (use 'yarn run set-full-edition' for the full edition)."
