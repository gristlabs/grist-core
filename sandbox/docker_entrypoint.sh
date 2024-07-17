#!/usr/bin/env bash
set -Eeuo pipefail

# Runs the command provided as arguments, but attempts to configure permissions first.

important_read_dirs=("/grist" "/persist")
write_dir="/persist"
current_user_id=$(id -u)

# We want to avoid running Grist as root if possible.
# Try to setup permissions and de-elevate to a normal user.
if [[ $current_user_id == 0 ]]; then
  target_user=${GRIST_DOCKER_USER:-grist}
  target_group=${GRIST_DOCKER_GROUP:-grist}

  # Make sure the target user owns everything that Grist needs write access to.
  find $write_dir ! -user "$target_user" -exec chown "$target_user" "{}" +

  # Make a home directory for the target user, in case anything needs to access it.
  export HOME="/grist_user_homes/${target_user}"
  mkdir -p "$HOME"
  chown -R "$target_user":"$target_group" "$HOME"

  # Restart as the target user, replacing the current process (replacement is needed for security).
  # Alternative tools to setpriv are: chroot, gosu.
  # Need to use `exec` to close the parent shell, to avoid vulnerabilities: https://github.com/tianon/gosu/issues/37
  exec setpriv --reuid "$target_user" --regid "$target_group" --init-groups /usr/bin/env bash "$0" "$@"
fi

# Printing the user helps with setting volume permissions.
echo "Running Grist as user $(id -u) with primary group $(id -g)"

# Validate that this user has access to the top level of each important directory.
# There might be a benefit to testing individual files, but this is simpler as the dir may start empty.
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
