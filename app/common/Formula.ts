/**
 *
 * This represents a formula supported under SQL for on-demand tables.  This is currently
 * a very small subset of the formulas supported by the data engine for regular tables.
 *
 * The following kinds of formula are supported:
 *   $refColId.colId    [where colId is not itself a formula]
 *   $colId             [where colId is not itself a formula]
 *   NNN                [a non-negative integer]
 * TODO: support a broader range of formula, by adding a parser or reusing Python parser.
 * An argument for reusing Python parser: wwe already do substantial parsing of the formula code.
 * E.g. Python does such amazing things as handle updating the formula when any of the columns
 * referred to in Foo.lookup(bar=$baz).blah get updated.
 *
 */
export type Formula = LiteralNumberFormula | ColumnFormula | ForeignColumnFormula | FormulaError;

// A simple copy of another column.  E.g. "$Person"
export interface ColumnFormula {
  kind: 'column';
  colId: string;
}

// A copy of a column in another table (via a reference column).  E.g. "$Person.FirstName"
export interface ForeignColumnFormula {
  kind: 'foreignColumn';
  colId: string;
  refColId: string;
}

export interface LiteralNumberFormula {
  kind: 'literalNumber';
  value: number;
}

// A formula that couldn't be parsed.
export interface FormulaError {
  kind: 'error';
  msg: string;
}

/**
 * Convert a string to a parsed formula.  Regexes are adequate for the very few
 * supported formulas, but once the syntax is at all flexible a proper parser will
 * be needed.  In principle, it might make sense to support python syntax, for
 * compatibility with the data engine, but compatibility in corner cases will be
 * fiddly given underlying differences between sqlite and python.
 */
export function parseFormula(txt: string): Formula {
  // Formula of form: $x.y
  let m = txt.match(/^\$([a-z]\w*)\.([a-z]\w*)$/i);
  if (m) {
    return {kind: 'foreignColumn', refColId: m[1], colId: m[2]};
  }

  // Formula of form: $x
  m = txt.match(/^\$([a-z][a-z_0-9]*)$/i);
  if (m) {
    return {kind: 'column', colId: m[1]};
  }

  // Formula of form: NNN
  m = txt.match(/^[0-9]+$/);
  if (m) {
    const value = parseInt(txt, 10);
    if (isNaN(value)) { return {kind: 'error', msg: 'Cannot parse integer'}; }
    return {kind: 'literalNumber', value};
  }

  // Everything else is an error.
  return {kind: 'error', msg: 'Formula not supported'};
}
