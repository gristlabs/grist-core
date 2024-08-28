export class StringUnionError extends TypeError {
  constructor(errMessage: string, public readonly actual: string, public readonly values: string[]) {
    super(errMessage);
  }
}

/**
 * TypeScript will infer a string union type from the literal values passed to
 * this function. Without `extends string`, it would instead generalize them
 * to the common string type.
 *
 * Example definition:
 * const Race = StringUnion(
 *   "orc",
 *   "human",
 *   "night elf",
 *   "undead",
 * );
 * type Race = typeof Race.type;
 *
 * For more details, see:
 * https://stackoverflow.com/questions/36836011/checking-validity-of-string
 *   -literal-union-type-at-runtime?answertab=active#tab-top
 */
export const StringUnion = <UnionType extends string>(...values: UnionType[]) => {
  Object.freeze(values);
  const valueSet: Set<string> = new Set(values);

  const guard = (value: string): value is UnionType => {
    return valueSet.has(value);
  };

  const check = (value: string): UnionType => {
    if (!guard(value)) {
      const actual = JSON.stringify(value);
      const expected = values.map(s => JSON.stringify(s)).join(' | ');
      throw new StringUnionError(`Value '${actual}' is not assignable to type '${expected}'.`, actual, values);
    }
    return value;
  };

  const checkAll = (arr: string[]): UnionType[] => {
    return arr.map(check);
  };

  /**
   * StringUnion.parse(value) returns value when it's valid, and undefined otherwise.
   */
  const parse = (value: string|null|undefined): UnionType|undefined => {
    return value != null && guard(value) ? value : undefined;
  };

  const unionNamespace = { guard, check, parse, values, checkAll };
  return Object.freeze(unionNamespace as typeof unionNamespace & {type: UnionType});
};
