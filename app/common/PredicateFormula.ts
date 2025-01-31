/**
 * Representation and compilation of predicate formulas.
 *
 * An example of a predicate formula is: "rec.office == 'Seattle' and user.email in ['sally@', 'xie@']".
 * These formulas are parsed in Python into a tree with nodes of the form [NODE_TYPE, ...args].
 * See sandbox/grist/predicate_formula.py for details.
 *
 * This module includes typings for the nodes, and the compilePredicateFormula() function that
 * turns such trees into actual predicate functions.
 */
import {CellValue, RowRecord} from 'app/common/DocActions';
import {ErrorWithCode} from 'app/common/ErrorWithCode';
import {InfoView} from 'app/common/RecordView';
import {UserInfo} from 'app/common/User';
import {decodeObject} from 'app/plugin/objtypes';
import constant = require('lodash/constant');

/**
 * Representation of a parsed predicate formula.
 */
export type PrimitiveCellValue = number|string|boolean|null;
export type ParsedPredicateFormula = [string, ...(ParsedPredicateFormula|PrimitiveCellValue)[]];

/**
 * Inputs to a predicate formula function.
 */
export interface PredicateFormulaInput {
  user?: UserInfo;
  rec?: RowRecord|InfoView;
  newRec?: InfoView;
  docId?: string;
  choice?: string|RowRecord|InfoView;
}

/**
 * The result of compiling ParsedPredicateFormula.
 */
export type CompiledPredicateFormula = (input: PredicateFormulaInput) => boolean;

const GRIST_CONSTANTS: Record<string, string> = {
  EDITOR: 'editors',
  OWNER: 'owners',
  VIEWER: 'viewers',
};

/**
 * An intermediate predicate formula returned during compilation, which may return
 * a non-boolean value.
 */
type IntermediatePredicateFormula = (input: PredicateFormulaInput) => any;

export interface CompilePredicateFormulaOptions {
  /** Defaults to `'acl'`. */
  variant?: 'acl'|'dropdown-condition';
}

/**
 * Compiles a parsed predicate formula and returns it.
 */
export function compilePredicateFormula(
  parsedPredicateFormula: ParsedPredicateFormula,
  options: CompilePredicateFormulaOptions = {}
): CompiledPredicateFormula {
  const {variant = 'acl'} = options;

  function compileNode(node: ParsedPredicateFormula): IntermediatePredicateFormula {
    const rawArgs = node.slice(1);
    const args = rawArgs as ParsedPredicateFormula[];
    switch (node[0]) {
      case 'And':   { const parts = args.map(compileNode); return (input) => parts.every(p => p(input)); }
      case 'Or':    { const parts = args.map(compileNode); return (input) => parts.some(p => p(input)); }
      case 'Add':   return compileAndCombine(args, ([a, b]) => a + b);
      case 'Sub':   return compileAndCombine(args, ([a, b]) => a - b);
      case 'Mult':  return compileAndCombine(args, ([a, b]) => a * b);
      case 'Div':   return compileAndCombine(args, ([a, b]) => a / b);
      case 'Mod':   return compileAndCombine(args, ([a, b]) => a % b);
      case 'Not':   return compileAndCombine(args, ([a]) => !a);
      case 'Eq':    return compileAndCombine(args, ([a, b]) => a === b);
      case 'NotEq': return compileAndCombine(args, ([a, b]) => a !== b);
      case 'Lt':    return compileAndCombine(args, ([a, b]) => a < b);
      case 'LtE':   return compileAndCombine(args, ([a, b]) => a <= b);
      case 'Gt':    return compileAndCombine(args, ([a, b]) => a > b);
      case 'GtE':   return compileAndCombine(args, ([a, b]) => a >= b);
      case 'Is':    return compileAndCombine(args, ([a, b]) => a === b);
      case 'IsNot': return compileAndCombine(args, ([a, b]) => a !== b);
      case 'In':    return compileAndCombine(args, ([a, b]) => Boolean(b?.includes(a)));
      case 'NotIn': return compileAndCombine(args, ([a, b]) => !b?.includes(a));
      case 'List':  return compileAndCombine(args, (values) => values);
      case 'Const': return constant(node[1] as CellValue);
      case 'Name': {
        const name = rawArgs[0] as keyof PredicateFormulaInput;
        if (GRIST_CONSTANTS[name]) { return constant(GRIST_CONSTANTS[name]); }

        let validNames: string[];
        switch (variant) {
          case 'acl': {
            validNames = ['newRec', 'rec', 'user'];
            break;
          }
          case 'dropdown-condition': {
            validNames = ['rec', 'choice', 'user'];
            break;
          }
        }
        if (!validNames.includes(name)) { throw new Error(`Unknown variable '${name}'`); }

        return (input) => input[name];
      }
      case 'Attr': {
        const attrName = rawArgs[1] as string;
        return compileAndCombine([args[0]], ([value]) => getAttr(value, attrName, args[0]));
      }
      case 'Call': {
        return compileAndCombine(args, (values) => {
          const func = values[0];
          if (!(func instanceof SupportedCallable)) {
            throw new Error(`Not a function: '${describeNode(args[0])}'`);
          }
          return func.func(...values.slice(1));
        });
      }
      case 'keywords': {
        // E.g. foo(a, b=2, c=3) becomes [Call, foo, a, [keywords, [b, 2], [c, 3]]],
        // which becomes foo(a, {b: 2, c: 3}).
        const pairs = rawArgs.filter((pair): pair is [string, ParsedPredicateFormula] =>
          Array.isArray(pair) && pair.length == 2 && typeof pair[0] === 'string');
        const keys = pairs.map(p => p[0]);
        const values = pairs.map(p => p[1]);
        return compileAndCombine(values, (compiledValues) =>
          Object.fromEntries(keys.map((k, i) => [k, compiledValues[i]])));
      }
      case 'Comment': return compileNode(args[0]);
    }
    throw new Error(`Unknown node type '${node[0]}'`);
  }

  /**
   * Helper for operators: compile a list of nodes, then when evaluating, evaluate them all and
   * combine the array of results using the given combine() function.
   */
  function compileAndCombine(
    args: ParsedPredicateFormula[],
    combine: (values: any[]) => any
  ): IntermediatePredicateFormula {
    const compiled = args.map(compileNode);
    return (input: PredicateFormulaInput) => combine(compiled.map(c => c(input)));
  }

  const compiledPredicateFormula = compileNode(parsedPredicateFormula);
  return (input) => Boolean(compiledPredicateFormula(input));
}

// Wrapper for callables that we explicitly support. We should be careful not to expose anything
// that could be used unsafely.
class SupportedCallable {
  constructor(public readonly func: Function) {}
}

function getStringMethod(value: string, attrName: string): SupportedCallable|undefined {
  switch (attrName) {
    case 'lower': return new SupportedCallable(() => value.toLowerCase());
    case 'upper': return new SupportedCallable(() => value.toUpperCase());
  }
  return undefined;
}

function describeNode(node: ParsedPredicateFormula): string {
  if (node[0] === 'Name') {
    return node[1] as string;
  } else if (node[0] === 'Attr') {
    return describeNode(node[1] as ParsedPredicateFormula) + '.' + (node[2] as string);
  } else {
    return 'value';
  }
}

function getAttr(value: any, attrName: string, valueNode: ParsedPredicateFormula): any {
  if (value == null) {
    if (valueNode[0] === 'Name' && (valueNode[1] === 'rec' || valueNode[1] === 'newRec')) {
      // This code is recognized by GranularAccess to know when an ACL rule is row-specific.
      throw new ErrorWithCode('NEED_ROW_DATA', `Missing row data '${valueNode[1]}'`);
    }
    throw new Error(`No value for '${describeNode(valueNode)}'`);
  }
  if (typeof value.get === 'function') {
    return decodeObject(value.get(attrName));  // InfoView
  } else if (typeof value === 'string') {
    return getStringMethod(value, attrName);
  } else if (value !== null && typeof value === 'object' &&
      !Array.isArray(value) &&            // We don't support attribute lookups on arrays.
      value.hasOwnProperty(attrName)) {
    // Check value and attrName more carefully to reduce the risk of shenanigans.
    return value[attrName];
  }
  return undefined;
}

/**
 * Predicate formula properties.
 */
export interface PredicateFormulaProperties {
  /**
   * List of column ids that are referenced by either `$` or `rec.` notation.
   */
  recColIds?: string[];
  /**
   * List of column ids that are referenced by `choice.` notation.
   *
   * Only applies to the `dropdown-condition` variant of predicate formulas,
   * and only for Reference and Reference List columns.
   */
  choiceColIds?: string[];
}

/**
 * Returns properties about a predicate `formula`.
 *
 * Properties include the list of column ids referenced in the formula.
 * Currently, this information is used for error validation; specifically, to
 * report when invalid column ids are referenced in ACL formulas and dropdown
 * conditions.
 */
export function getPredicateFormulaProperties(
  formula: ParsedPredicateFormula
): PredicateFormulaProperties {
  return {
    recColIds: [...getRecColIds(formula)],
    choiceColIds: [...getChoiceColIds(formula)],
  };
}

function isRecOrNewRec(formula: ParsedPredicateFormula|PrimitiveCellValue): boolean {
  return Array.isArray(formula) &&
    formula[0] === 'Name' &&
    (formula[1] === 'rec' || formula[1] === 'newRec');
}

function getRecColIds(formula: ParsedPredicateFormula): string[] {
  return [...new Set(collectColIds(formula, isRecOrNewRec))];
}

function isChoice(formula: ParsedPredicateFormula|PrimitiveCellValue): boolean {
  return Array.isArray(formula) && formula[0] === 'Name' && formula[1] === 'choice';
}

function getChoiceColIds(formula: ParsedPredicateFormula): string[] {
  return [...new Set(collectColIds(formula, isChoice))];
}

function collectColIds(
  formula: ParsedPredicateFormula,
  isIdentifierWithColIds: (formula: ParsedPredicateFormula|PrimitiveCellValue) => boolean,
): string[] {
  if (!Array.isArray(formula)) { throw new Error('expected a list'); }
  if (formula[0] === 'Attr' && isIdentifierWithColIds(formula[1])) {
    const colId = String(formula[2]);
    return [colId];
  }
  return formula.flatMap(el => Array.isArray(el) ? collectColIds(el, isIdentifierWithColIds) : []);
}
