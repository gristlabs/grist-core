/**
 * Sort namespace provides helper function to work with sort expression.
 *
 * Sort expression is a list of column sort expressions, each describing how to
 * sort particular column. Column expression can be either:
 *
 * - Positive number: column with matching id will be sorted in ascending order
 * - Negative number: column will be sorted in descending order
 * - String containing a positive number: same as above
 * - String containing a negative number: same as above
 * - String containing a number and sorting options:
 *   '1:flag1;flag2;flag3'
 *   '-1:flag1;flag2;flag3'
 *   Sorting options modifies the sorting algorithm, supported options are:
 *   - orderByChoice: For choice column sorting function will use choice item order
 *                    instead of choice label text.
 *   - emptyLast:     Treat empty values as greater than non empty (default is empty values first).
 *   - naturalSort:   For text based columns, sorting function will compare strings with numbers
 *                    taking their numeric value rather then text representation ('a2' before 'a11)
 */
export namespace Sort {
  /**
   * Object base representation for column expression.
   */
  export interface ColSpecDetails {
    colRef: number;
    direction: Direction;
    orderByChoice?: boolean;
    emptyLast?: boolean;
    naturalSort?: boolean;
  }
  /**
   * Column expression type.
   */
  export type ColSpec = number | string;
  /**
   * Sort expression type, for example [1,-2, '3:emptyLast', '-4:orderByChoice']
   */
  export type SortSpec = Array<ColSpec>;
  export type Direction = 1 | -1;
  export const ASC: Direction = 1;
  export const DESC: Direction = -1;

  const NOT_FOUND = -1;

  // Flag separator
  const FLAG_SEPARATOR = ";";
  // Separator between colRef and sorting options.
  const OPTION_SEPARATOR = ":";

  /**
   * Checks if column expression has any sorting options.
   */
  export function hasOptions(colSpec: ColSpec | ColSpecDetails): boolean {
    if (typeof colSpec === "number") {
      return false;
    }
    const details = typeof colSpec !== "object" ? specToDetails(colSpec) : colSpec;
    return Boolean(details.emptyLast || details.naturalSort || details.orderByChoice);
  }

  /**
   * Converts column sort expression from object representation to encoded form.
   */
  export function detailsToSpec(d: ColSpecDetails): ColSpec {
    const head = `${d.direction === ASC ? "" : "-"}${d.colRef}`;
    const tail = [];
    if (d.emptyLast) {
      tail.push("emptyLast");
    }
    if (d.naturalSort) {
      tail.push("naturalSort");
    }
    if (d.orderByChoice) {
      tail.push("orderByChoice");
    }
    if (!tail.length) {
      return +head;
    }
    return head + (tail.length ? OPTION_SEPARATOR : "") + tail.join(FLAG_SEPARATOR);
  }

  /**
   * Converts column expression to object representation.
   */
  export function specToDetails(colSpec: ColSpec): ColSpecDetails {
    return typeof colSpec === "number"
      ? {
          colRef: Math.abs(colSpec),
          direction: colSpec >= 0 ? ASC: DESC,
        }
      : parseColSpec(colSpec);
  }

  function parseColSpec(colString: string): ColSpecDetails {
    const REGEX = /^(-)?(\d+)(:([\w\d;]+))?$/;
    const match = colString.match(REGEX);
    if (!match) {
      throw new Error("Error parsing sort expression " + colString);
    }
    const [, sign, colRef, , flag] = match;
    const flags = flag?.split(";");
    return {
      colRef: +colRef,
      direction: sign === "-" ? DESC : ASC,
      orderByChoice: flags?.includes("orderByChoice"),
      emptyLast: flags?.includes("emptyLast"),
      naturalSort: flags?.includes("naturalSort"),
    };
  }

  /**
   * Extracts colRef (column row id) from column sorting expression.
   */
  export function getColRef(colSpec: ColSpec) {
    if (typeof colSpec === "number") {
      return Math.abs(colSpec);
    }
    return parseColSpec(colSpec).colRef;
  }

  /**
   * Swaps column expressions.
   */
  export function swap(spec: SortSpec, colA: ColSpec, colB: ColSpec): SortSpec {
    const aIndex = findColIndex(spec, colA);
    const bIndex = findColIndex(spec, colB);
    if (aIndex === NOT_FOUND || bIndex === NOT_FOUND) {
      throw new Error(`Column expressions can be found (${colA} or ${colB})`);
    }
    const clone = spec.slice();
    clone[aIndex] = spec[bIndex];
    clone[bIndex] = spec[aIndex];
    return clone;
  }

  /**
   * Converts column expression order.
   */
  export function setColDirection(colSpec: ColSpec, dir: Direction): ColSpec {
    if (typeof colSpec === "number") {
      return Math.abs(colSpec) * dir;
    }
    return detailsToSpec({ ...parseColSpec(colSpec), direction: dir });
  }

  /**
   * Creates simple column expression.
   */
  export function createColSpec(colRef: number, dir: Direction): ColSpec {
    return colRef * dir;
  }

  /**
   * Checks if a column expression is already included in sorting spec. Doesn't check sorting options.
   */
  export function contains(spec: SortSpec, colSpec: ColSpec, dir: Direction) {
    const existing = findCol(spec, colSpec);
    return !!existing && getColRef(existing) === getColRef(colSpec) && direction(existing) === dir;
  }

  export function containsOnly(spec: SortSpec, colSpec: ColSpec, dir: Direction) {
    return spec.length === 1 && contains(spec, colSpec, dir);
  }

  /**
   * Checks if a column is sorted in ascending order.
   */
  export function isAscending(colSpec: ColSpec): boolean {
    if (typeof colSpec === "number") {
      return colSpec >= 0;
    }
    return parseColSpec(colSpec).direction === ASC;
  }

  export function direction(colSpec: ColSpec): Direction {
    return isAscending(colSpec) ? ASC : DESC;
  }

  /**
   * Checks if two column expressions refers to the same column.
   */
  export function sameColumn(colSpec: ColSpec, colRef: ColSpec): boolean {
    return getColRef(colSpec) === getColRef(colRef);
  }

  /**
   * Swaps column id in column expression. Primary use for display columns.
   */
  export function swapColRef(colSpec: ColSpec, colRef: number): ColSpec {
    if (typeof colSpec === "number") {
      return colSpec >= 0 ? colRef : -colRef;
    }
    const spec = parseColSpec(colSpec);
    return detailsToSpec({...spec, colRef});
  }

  /**
   * Finds an index of column expression in a sorting expression.
   */
  export function findColIndex(sortSpec: SortSpec, colRef: ColSpec): number {
    return sortSpec.findIndex(colSpec => sameColumn(colSpec, colRef));
  }

  export function removeCol(sortSpec: SortSpec, colRef: ColSpec): SortSpec {
    return sortSpec.filter(col => getColRef(col) !== getColRef(colRef));
  }

  /**
   * Finds a column expression in sorting expression (regardless sorting option).
   */
  export function findCol(sortSpec: SortSpec, colRef: ColSpec): ColSpec | undefined {
    const result = sortSpec.find(colSpec => sameColumn(colSpec, colRef));
    return result;
  }

  /**
   * Inserts new column sort options at the index of an existing column options (and removes the old one).
   * If the old column can't be found it does nothing.
   * @param colRef Column id to remove
   * @param newSpec New column sort options to put in place of the old one.
   */
  export function replace(sortSpec: SortSpec, colRef: number, newSpec: ColSpec | ColSpecDetails): SortSpec {
    const index = findColIndex(sortSpec, colRef);
    if (index >= 0) {
      const updated = sortSpec.slice();
      updated[index] = typeof newSpec === "object" ? detailsToSpec(newSpec) : newSpec;
      return updated;
    }
    return sortSpec;
  }

  /**
   * Flips direction for a single column, returns a new object.
   */
  export function flipCol(colSpec: ColSpec): ColSpec {
    if (typeof colSpec === "number") {
      return -colSpec;
    }
    const spec = parseColSpec(colSpec);
    return detailsToSpec({ ...spec, direction: spec.direction === ASC ? DESC : ASC });
  }

  // Takes an activeSortSpec and sortRef to flip and returns a new
  // activeSortSpec with that sortRef flipped (or original spec if sortRef not found).
  export function flipSort(spec: SortSpec, colSpec: ColSpec): SortSpec {
    const idx = findColIndex(spec, getColRef(colSpec));
    if (idx !== NOT_FOUND) {
      const newSpec = Array.from(spec);
      newSpec[idx] = flipCol(newSpec[idx]);
      return newSpec;
    }
    return spec;
  }

  export function setSortDirection(spec: SortSpec, colSpec: ColSpec, dir: Direction): SortSpec {
    const idx = findColIndex(spec, getColRef(colSpec));
    if (idx !== NOT_FOUND) {
      const newSpec = Array.from(spec);
      newSpec[idx] = setColDirection(newSpec[idx], dir);
      return newSpec;
    }
    return spec;
  }

  // Parses the sortColRefs string, defaulting to an empty array on invalid input.
  export function parseSortColRefs(sortColRefs: string): SortSpec {
    try {
      return JSON.parse(sortColRefs);
    } catch (err) {
      return [];
    }
  }

  // Given the current sort spec, moves colSpec to be immediately before nextColSpec. Moves v
  // to the end of the sort spec if nextColSpec is null.
  // If the given colSpec or nextColSpec cannot be found, return sortSpec unchanged.
  // ColSpec are identified only by colRef (order or options don't matter).
  export function reorderSortRefs(spec: SortSpec, colSpec: ColSpec, nextColSpec: ColSpec | null): SortSpec {
    const updatedSpec = spec.slice();

    // Remove sortRef from sortSpec.
    const _idx = findColIndex(updatedSpec, colSpec);
    if (_idx === NOT_FOUND) {
      return spec;
    }
    updatedSpec.splice(_idx, 1);

    // Add sortRef to before nextSortRef
    const _nextIdx = nextColSpec ? findColIndex(updatedSpec, nextColSpec) : updatedSpec.length;
    if (_nextIdx === NOT_FOUND) {
      return spec;
    }
    updatedSpec.splice(_nextIdx, 0, colSpec);

    return updatedSpec;
  }

  // Helper function for query based sorting, which uses column names instead of columns ids.
  // Translates expressions like -Pet, to an colRef expression like -1.
  // NOTE: For column with zero index, it will return a string.
  export function parseNames(sort: string[], colIdToRef: Map<string, number>): SortSpec {
    const COL_SPEC_REG = /^(-)?([\w]+)(:.+)?/;
    return sort.map((colSpec) => {
      const match = colSpec.match(COL_SPEC_REG);
      if (!match) {
        throw new Error(`unknown key ${colSpec}`);
      }
      const [, sign, key, options] = match;
      let colRef = Number(key);
      if (!isNaN(colRef)) {
        // This might be valid colRef
        if (![...colIdToRef.values()].includes(colRef)) {
          throw new Error(`invalid column id ${key}`);
        }
      } else if (!colIdToRef.has(key)) {
        throw new Error(`unknown key ${key}`);
      } else {
        colRef = colIdToRef.get(key)!;
      }
      return `${sign || ""}${colRef}${options ?? ""}`;
    });
  }
}
