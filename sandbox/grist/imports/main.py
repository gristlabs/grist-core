"""This module loads a file_importer that implements the Grist import
API, and calls its selected method passing argument received from
PluginManager.sandboxImporter(). It returns an object formatted so
that it can be used by Grist.

"""
import sys
import argparse
import logging
import imp
import json
import marshal
log = logging.getLogger(__name__)

# Include /thirdparty into module search paths, in particular for messytables.
# pylint: disable=wrong-import-position
sys.path.append('/thirdparty')

def marshal_data(export_list):
  return marshal.dumps(export_list, 2)

def main():

  parser = argparse.ArgumentParser()
  parser.add_argument('-d', '--debug', action='store_true',
                      help="Print debug instead of producing normal binary output")
  parser.add_argument('-t', '--table',
                      help="Suggested table name to use with CSV imports")
  parser.add_argument('-n', '--plugin-name', required=True,
                      help="Name of a python module implementing the import API.")
  parser.add_argument('-p', '--plugin-path',
                      help="Location of the module.")
  parser.add_argument('--action-options',
                      help="Options to pass to the action. See API documentation.")
  parser.add_argument('action', help='Action to call',
                      choices=['can_parse', 'parse_file'])
  parser.add_argument('input', help='File to convert')
  args = parser.parse_args()

  s = logging.StreamHandler()
  s.setFormatter(logging.Formatter(fmt='%(asctime)s.%(msecs)03d %(message)s',
                                   datefmt='%Y-%m-%d %H:%M:%S'))
  rootLogger = logging.getLogger()
  rootLogger.addHandler(s)
  rootLogger.setLevel(logging.DEBUG if args.debug else logging.INFO)
  import_plugin = imp.load_compiled(
    args.plugin_name,
    args.plugin_path)
  options = {}
  if args.action_options:
    options = json.loads(args.action_options)
  parsed_data = getattr(import_plugin, args.action)(args.input, **options)
  marshalled_data = marshal_data(parsed_data)
  log.info("Marshalled data has %d bytes", len(marshalled_data))
  if not args.debug:
    sys.stdout.write(marshalled_data)


if __name__ == "__main__":
  main()
