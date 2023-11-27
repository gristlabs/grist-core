/**
 * Representation and compilation of ACL formulas.
 *
 * An example of an ACL formula is: "rec.office == 'Seattle' and user.email in ['sally@', 'xie@']".
 * These formulas are parsed in Python into a tree with nodes of the form [NODE_TYPE, ...args].
 * See sandbox/grist/acl_formula.py for details.
 *
 * This modules includes typings for the nodes, and compileAclFormula() function that turns such a
 * tree into an actual boolean function.
 */
import {CellValue} from 'app/common/DocActions';
import {ErrorWithCode} from 'app/common/ErrorWithCode';
import {AclMatchFunc, AclMatchInput, ParsedAclFormula} from 'app/common/GranularAccessClause';
import {decodeObject} from "app/plugin/objtypes";
import constant = require('lodash/constant');

const GRIST_CONSTANTS: Record<string, string> = {
  EDITOR: 'editors',
  OWNER: 'owners',
  VIEWER: 'viewers',
};

/**
 * Compile a parsed ACL formula into an actual function that can evaluate a request.
 */
export function compileAclFormula(parsedAclFormula: ParsedAclFormula): AclMatchFunc {
  const compiled = _compileNode(parsedAclFormula);
  return (input) => Boolean(compiled(input));
}

/**
 * Type for intermediate functions, which may return values other than booleans.
 */
type AclEvalFunc = (input: AclMatchInput) => any;

/**
 * Compile a single node of the parsed formula tree.
 */
function _compileNode(parsedAclFormula: ParsedAclFormula): AclEvalFunc {
  const rawArgs = parsedAclFormula.slice(1);
  const args = rawArgs as ParsedAclFormula[];
  switch (parsedAclFormula[0]) {
    case 'And':   { const parts = args.map(_compileNode); return (input) => parts.every(p => p(input)); }
    case 'Or':    { const parts = args.map(_compileNode); return (input) => parts.some(p => p(input)); }
    case 'Add':   return _compileAndCombine(args, ([a, b]) => a + b);
    case 'Sub':   return _compileAndCombine(args, ([a, b]) => a - b);
    case 'Mult':  return _compileAndCombine(args, ([a, b]) => a * b);
    case 'Div':   return _compileAndCombine(args, ([a, b]) => a / b);
    case 'Mod':   return _compileAndCombine(args, ([a, b]) => a % b);
    case 'Not':   return _compileAndCombine(args, ([a]) => !a);
    case 'Eq':    return _compileAndCombine(args, ([a, b]) => a === b);
    case 'NotEq': return _compileAndCombine(args, ([a, b]) => a !== b);
    case 'Lt':    return _compileAndCombine(args, ([a, b]) => a < b);
    case 'LtE':   return _compileAndCombine(args, ([a, b]) => a <= b);
    case 'Gt':    return _compileAndCombine(args, ([a, b]) => a > b);
    case 'GtE':   return _compileAndCombine(args, ([a, b]) => a >= b);
    case 'Is':    return _compileAndCombine(args, ([a, b]) => a === b);
    case 'IsNot': return _compileAndCombine(args, ([a, b]) => a !== b);
    case 'In':    return _compileAndCombine(args, ([a, b]) => Boolean(b?.includes(a)));
    case 'NotIn': return _compileAndCombine(args, ([a, b]) => !b?.includes(a));
    case 'List':  return _compileAndCombine(args, (values) => values);
    case 'Const': return constant(parsedAclFormula[1] as CellValue);
    case 'Name': {
      const name = rawArgs[0] as keyof AclMatchInput;
      if (GRIST_CONSTANTS[name]) { return constant(GRIST_CONSTANTS[name]); }
      if (!['user', 'rec', 'newRec'].includes(name)) {
        throw new Error(`Unknown variable '${name}'`);
      }
      return (input) => input[name];
    }
    case 'Attr': {
      const attrName = rawArgs[1] as string;
      return _compileAndCombine([args[0]], ([value]) => getAttr(value, attrName, args[0]));
    }
    case 'Comment': return _compileNode(args[0]);
  }
  throw new Error(`Unknown node type '${parsedAclFormula[0]}'`);
}

function describeNode(node: ParsedAclFormula): string {
  if (node[0] === 'Name') {
    return node[1] as string;
  } else if (node[0] === 'Attr') {
    return describeNode(node[1] as ParsedAclFormula) + '.' + (node[2] as string);
  } else {
    return 'value';
  }
}

function getAttr(value: any, attrName: string, valueNode: ParsedAclFormula): any {
  if (value == null) {
    if (valueNode[0] === 'Name' && (valueNode[1] === 'rec' || valueNode[1] === 'newRec')) {
      // This code is recognized by GranularAccess to know when a rule is row-specific.
      throw new ErrorWithCode('NEED_ROW_DATA', `Missing row data '${valueNode[1]}'`);
    }
    throw new Error(`No value for '${describeNode(valueNode)}'`);
  }
  return (typeof value.get === 'function' ? decodeObject(value.get(attrName)) : // InfoView
          value[attrName]);
}

/**
 * Helper for operators: compile a list of nodes, then when evaluating, evaluate them all and
 * combine the array of results using the given combine() function.
 */
function _compileAndCombine(args: ParsedAclFormula[], combine: (values: any[]) => any): AclEvalFunc {
  const compiled = args.map(_compileNode);
  return (input: AclMatchInput) => combine(compiled.map(c => c(input)));
}
