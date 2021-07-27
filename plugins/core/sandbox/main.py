import logging
import sandbox

import import_csv
import import_xls
import import_json

def main():
  s = logging.StreamHandler()
  s.setFormatter(logging.Formatter(fmt='%(asctime)s.%(msecs)03d %(message)s',
                                   datefmt='%Y-%m-%d %H:%M:%S'))
  rootLogger = logging.getLogger()
  rootLogger.addHandler(s)
  rootLogger.setLevel(logging.INFO)

  # Todo: Grist should expose a register method accepting arguments as
  # follow: register('csv_parser', 'canParse', can_parse)
  sandbox.register("csv_parser.parseFile", import_csv.parse_file_source)
  sandbox.register("xls_parser.parseFile", import_xls.import_file)
  sandbox.register("json_parser.parseFile", import_json.parse_file)

  sandbox.run()

if __name__ == "__main__":
  main()
