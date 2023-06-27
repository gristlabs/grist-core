import sandbox

# pylint: disable=unused-argument
# pylint: disable=no-member

# TODO: configure pylint behavior for both `test/fixtures/plugins` and
# `/plugins` folders: either to ignore them completely or to ignore
# above mentioned rules.

def import_files(file_source, parse_options):
  parse_options.update({"NUM_ROWS" : 1})
  return {
    "parseOptions": parse_options,
    "tables": [{
      "table_name": "mytable",
      "column_metadata": [],
      "table_data": []
    }]}


def main():
  # Todo: Grist should expose a register method accepting arguments as
  # follow: register('csv_parser', 'parseFile', can_parse)
  sandbox.register("csv_parser.parseFile", import_files)
  sandbox.run() # pylint: disable=no-member


if __name__ == "__main__":
  main()
