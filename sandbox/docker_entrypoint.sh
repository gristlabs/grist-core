#!/usr/bin/env bash
set -Eeuo pipefail

# Runs the command provided as arguments, but attempts to configure permissions first.

important_read_dirs=("/grist" "/persist")
important_write_dirs=("/persist")
important_dirs=( "${important_read_dirs[@]}" "${important_write_dirs[@]}" )
current_user_id=$(id -u)

# We want to avoid running Grist as root if possible.
# Try to setup permissions and de-elevate to a normal user.
if [[ $current_user_id == 0 ]]; then
  target_user=${GRIST_DOCKER_USER:-grist}
  target_group=${GRIST_DOCKER_GROUP:-grist}

  for dir in "${important_dirs[@]}"; do
    # Make sure the target user owns everything that Grist needs read/write access to.
    find "$dir" ! -user "$target_user" -exec chown "$target_user" "{}" +
  done

  # Restart as the target user, replacing the current process (replacement is needed for security).
  # Alternative tools are: setpriv, chroot, gosu.
  exec setpriv --reuid "$target_user" --regid "$target_group" --init-groups /usr/bin/env bash "$BASH_SOURCE" "$@"
fi

# Validate that this user has access to the top level of each important directory.
# There might be a benefit to testing an individual file in there,
for dir in "${important_read_dirs[@]}"; do
  if ! { test -r "$dir" ;} ; then
    echo "Invalid permissions, cannot read '$dir'. Aborting." >&2
    exit 1
  fi
done
for dir in "${important_write_dirs[@]}"; do
  if ! { test -r "$dir" && test -w "$dir" ;} ; then
    echo "Invalid permissions, cannot write '$dir'. Aborting." >&2
    exit 1
  fi
done

exec /usr/bin/tini -s -- "$@"
