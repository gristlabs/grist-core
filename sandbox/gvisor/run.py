#!/usr/bin/env python3

# Run a command under gvisor, setting environment variables and sharing certain
# directories in read only mode.  Specialized for running python, and (for testing)
# bash.  Does not change directory structure, for unprivileged operation.

# Contains plenty of hard-coded paths that assume we are running within
# a container.

import argparse
import glob
import json
import os
import subprocess
import sys
import tempfile

# Separate arguments before and after a -- divider.
from itertools import groupby
all_args = sys.argv[1:]
all_args = [list(group) for k, group in groupby(all_args, lambda x: x == "--") if not k]
main_args = all_args[0]   # args before the -- divider, for this script.
more_args = all_args[1] if len(all_args) > 1 else []    # args after the -- divider
                                                        # to pass on to python/bash.

# Set up options.
parser = argparse.ArgumentParser(description='Run something in gvisor (runsc).')
parser.add_argument('command', choices=['bash', 'python2', 'python3'])
parser.add_argument('--dry-run', '-d', action='store_true',
                    help="print config")
parser.add_argument('--env', '-E', action='append')
parser.add_argument('--mount', '-m', action='append')
parser.add_argument('--restore', '-r')
parser.add_argument('--checkpoint', '-c')
parser.add_argument('--start', '-s')  # allow overridding the entrypoint
parser.add_argument('--faketime')

# If CHECK_FOR_TERMINAL is set, just determine whether we will be running bash, and
# exit with success if so.  This is so if we are being wrapped in docker, it can be
# started in interactive mode.
if os.environ.get('CHECK_FOR_TERMINAL') == '1':
  args = parser.parse_args(main_args)
  exit(0 if args.command == 'bash' else -1)

args = parser.parse_args(main_args)

sys.stderr.write('run.py: ' + ' '.join(sys.argv) + "\n")
sys.stderr.flush()

include_bash = args.command == 'bash'
include_python2 = args.command == 'python2'
include_python3 = args.command == 'python3'

# Basic settings for gvisor's runsc.  This follows the standard OCI specification:
#   https://github.com/opencontainers/runtime-spec/blob/master/config.md
cmd_args = []
mounts = [             # These will be filled in more fully programmatically below.
  {
    "destination": "/proc",  # gvisor virtualizes /proc
    "source": "/proc",
    "type": "/procfs"
  },
  {
    "destination": "/sys",  # gvisor virtualizes /sys
    "source": "/sys",
    "type": "/sysfs",
    "options": [
      "nosuid",
      "noexec",
      "nodev",
      "ro"
    ]
  }
]
preserved = set()
env = [
  "PATH=/usr/local/bin:/usr/bin:/bin",
  "LD_LIBRARY_PATH=/usr/local/lib"      # Assumes python version in /usr/local
] + (args.env or [])
settings = {
  "ociVersion": "1.0.0",
  "process": {
    "terminal": include_bash,
    # Match current user id, for convenience with mounts. For some versions of
    # gvisor, default behavior may be better - if you see "access denied" problems
    # during imports, try commenting this section out. We could make imports work
    # for any version of gvisor by setting mode when using tmp.dir to allow
    # others to list directory contents.
    "user": {
      "uid": os.getuid(),
      "gid": 0
    },
    "args": cmd_args,
    "env": env,
    "cwd": "/"
  },
  "root": {
    "path": "/",        # The fork of gvisor we use shares paths with host.
    "readonly": True    # Read-only access by default, and we will blank out most
    # of the host with empty "tmpfs" mounts.
  },
  "hostname": "gristland",
  "mounts": mounts,
  "linux": {
    "namespaces": [
      {
        "type": "pid"
      },
      {
        "type": "network"
      },
      {
        "type": "ipc"
      },
      {
        "type": "uts"
      },
      {
        "type": "mount"
      }
    ]
  }
}
memory_limit = os.environ.get('GVISOR_LIMIT_MEMORY')
if memory_limit:
  settings['process']['rlimits'] = [
    {
      "type": "RLIMIT_AS",
      "hard": int(memory_limit),
      "soft": int(memory_limit)
    }
  ]

# Helper for preparing a mount.
def preserve(*locations, short_failure=False):
  for location in locations:
    # Check the requested directory is visible on the host, and that there hasn't been a
    # muddle.  For Grist, this could happen if a parent directory of a temporary import
    # directory hasn't been made available to the container this code runs in, for example.
    if not os.path.exists(location):
      if short_failure:
        raise Exception('cannot find: ' + location)
      raise Exception('cannot find: ' + location + ' ' +
                      '(if tmp path, make sure TMPDIR when running grist and GRIST_TMP line up)')
    mounts.append({
      "destination": location,
      "source": location,
      "options": ["ro"],
      "type": "bind"
    })
    preserved.add(location)

# Prepare the file system - blank out everything that need not be shared.
exceptions = ["lib", "lib64"]   # to be shared (read-only)
exceptions += ["proc", "sys"]   # already virtualized

# retain /bin and /usr/bin for utilities
start = args.start
if include_bash or start:
  exceptions.append("bin")
  preserve("/usr/bin")

preserve("/usr/local/lib")
if os.path.exists('/lib64'):
  preserve("/lib64")
if os.path.exists('/usr/lib64'):
  preserve("/usr/lib64")
preserve("/usr/lib")

# include python3 for bash and python3
best = None
if not include_python2:
  # We expect python3 in /usr/bin or /usr/local/bin.
  candidates = [
    path
    # Pick the most generic python if not matching python3.11.
    # Sorry this is delicate because of restores, mounts, symlinks.
    for pattern in ['python3.11', 'python3.10', 'python3.9', 'python3', 'python3*']
    for root in ['/usr/local', '/usr']
    for path in glob.glob(f'{root}/bin/{pattern}')
    if os.path.exists(path)
  ]
  if not candidates:
    raise Exception('could not find python3')
  best = os.path.realpath(candidates[0])
  preserve(best)

# include python2 for bash and python2
if not include_python3:
  # Try to include python2 only if it is present or we were specifically asked for it.
  # This is to facilitate testing on a python3-only container.
  if os.path.exists("/usr/bin/python2.7") or include_python2:
    preserve("/usr/bin/python2.7", short_failure=True)
    best = "/usr/bin/python2.7"
  preserve("/usr/lib")

# Set up any specific shares requested.
if args.mount:
  preserve(*args.mount)

for directory in os.listdir('/'):
  if directory not in exceptions and ("/" + directory) not in preserved:
    mounts.insert(0, {
      # This places an empty directory at this destination.
      # Follow any symlinks since otherwise there is an error.
      "destination": os.path.realpath("/" + directory),
      "type": "tmpfs"
    })

# Set up faketime inside the sandbox if requested.  Can't be set up outside the sandbox,
# because gvisor is written in Go and doesn't use the standard library that faketime
# tweaks.
if args.faketime:
  preserve('/usr/lib/x86_64-linux-gnu/faketime')
  cmd_args.append('faketime')
  cmd_args.append('-f')
  cmd_args.append('2020-01-01 00:00:00' if args.faketime == 'default' else args.faketime)
  preserve('/usr/bin/faketime')
  preserve('/bin/date')

# Pick and set an initial entry point (bash or python).
if start:
  cmd_args.append(start)
else:
  cmd_args.append('bash' if include_bash else best)

# Add any requested arguments for the program that will be run.
cmd_args += more_args

# Helper for assembling a runsc command.
# Takes the directory to work in and a list of arguments to append.
def make_command(root_dir, action):
  flag_string = os.environ.get('GVISOR_FLAGS') or '-rootless'
  flags = flag_string.split(' ')
  command = ["runsc",
             "-root", "/tmp/runsc",   # Place container information somewhere writable.
            ] + flags + [
             "-network",
             "none"] + action + [
             root_dir.replace('/', '_')]  # Derive an arbitrary container name.
  return command

# Generate the OCI spec as config.json in a temporary directory, and either show
# it (if --dry-run) or pass it on to gvisor runsc.
with tempfile.TemporaryDirectory() as root:  # pylint: disable=no-member
  config_filename = os.path.join(root, 'config.json')
  with open(config_filename, 'w') as fout:
    json.dump(settings, fout, indent=2)
  if args.dry_run:
    with open(config_filename, 'r') as fin:
      spec = json.load(fin)
      print(json.dumps(spec, indent=2))
  else:
    if not args.checkpoint:
      if args.restore:
        command = make_command(root, ["restore", "--image-path=" + args.restore])
      else:
        command = make_command(root, ["run"])
      result = subprocess.run(command, cwd=root)  # pylint: disable=no-member
      if result.returncode != 0:
        raise Exception('gvisor runsc problem: ' + json.dumps(command))
    else:
      # We've been asked to make a checkpoint.
      # Start up the sandbox, and wait for it to emit a message on stderr ('Ready').
      command = make_command(root, ["run"])
      process = subprocess.Popen(command, cwd=root, stderr=subprocess.PIPE)
      text = process.stderr.readline().decode('utf-8')  # wait for ready
      if 'Ready' in text:
        sys.stderr.write('Ready message: ' + text)
        sys.stderr.flush()
      else:
        # Something unexpected has happened, echo the full error and hang.
        while True:
          sys.stderr.write('Problem: ' + text)
          sys.stderr.flush()
          text = process.stderr.readline().decode('utf-8')
      # Remove existing checkpoint if present.
      if os.path.exists(os.path.join(args.checkpoint, 'checkpoint.img')):
        os.remove(os.path.join(args.checkpoint, 'checkpoint.img'))
      if os.path.exists(os.path.join(args.checkpoint, 'checkpoint.json')):
        os.remove(os.path.join(args.checkpoint, 'checkpoint.json'))
      # Make the directory, so we will later have the right to delete the checkpoint if
      # we wish to replace it. Otherwise there is a muddle around permissions.
      if not os.path.exists(args.checkpoint):
        os.makedirs(args.checkpoint)
      # Go ahead and run the runsc checkpoint command.
      # This is destructive, it will kill the sandbox we are checkpointing.
      command = make_command(root, ["checkpoint", "--image-path=" + args.checkpoint])
      result = subprocess.run(command, cwd=root)  # pylint: disable=no-member
      if result.returncode != 0:
        raise Exception('gvisor runsc checkpointing problem: ' + json.dumps(command))
      # Save the configuration of the checkpoint for easy reference.
      with open(config_filename, 'r', encoding='utf-8') as fin:
        with open(os.path.join(args.checkpoint, 'checkpoint.json'), 'w', encoding='utf-8') as fout:
          spec = json.load(fin)
          json.dump(spec, fout, indent=2)
      # We are done!
