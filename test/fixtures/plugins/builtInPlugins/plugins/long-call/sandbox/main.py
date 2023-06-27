import time
import sandbox

# pylint: disable=unused-argument
# pylint: disable=no-member

def import_files(file_source, parse_options):
  end = time.time() + 1
  while time.time() < end:
    pass
  return {
    "parseOptions": {},
    # Make sure the output is a list of GristTables as documented at app/plugin/GristTable.ts
    "tables": [{
      "table_name": "mytable",
      "column_metadata": [],
      "table_data": [],
    }]
  }


def main():
  sandbox.register("csv_parser.parseFile", import_files)
  sandbox.run() # pylint: disable=no-member


if __name__ == "__main__":
  main()
