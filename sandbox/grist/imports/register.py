def register_import_parsers(sandbox):
  def parse_csv(file_source, options):
    from imports.import_csv import parse_file_source
    return parse_file_source(file_source, options)

  sandbox.register("csv_parser.parseFile", parse_csv)

  def parse_excel(file_source, parse_options):
    # pylint: disable=unused-argument
    from imports.import_xls import import_file
    return import_file(file_source)

  sandbox.register("xls_parser.parseFile", parse_excel)

  def parse_json(file_source, parse_options):
    from imports.import_json import parse_file
    return parse_file(file_source, parse_options)

  sandbox.register("json_parser.parseFile", parse_json)
