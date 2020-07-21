import {DatabaseType} from 'typeorm';

/**
 *
 * Generates an expression to simulate postgres's bit_or
 * aggregate function in sqlite.  The expression is verbose,
 * and has a term for each bit in the permission bitmap,
 * but this seems ok since sqlite is only used in the dev
 * environment.
 * @param column: the sql column to aggregate
 * @param bits: the maximum number of bits to consider
 *
 */
export function sqliteBitOr(column: string, bits: number): string {
  const parts: string[] = [];
  let mask: number = 1;
  for (let b = 0; b < bits; b++) {
    parts.push(`((sum(${column}&${mask})>0)<<${b})`);
    mask *= 2;
  }
  return `(${parts.join('+')})`;
}

/**
 * Generates an expression to aggregate the named column
 * by taking the bitwise-or of all the values it takes on.
 * @param dbType: the type of database (sqlite and postgres are supported)
 * @param column: the sql column to aggregate
 * @param bits: the maximum number of bits to consider (used for sqlite variant)
 */
export function bitOr(dbType: DatabaseType, column: string, bits: number): string {
  switch (dbType) {
    case 'postgres':
      return `bit_or(${column})`;
    case 'sqlite':
      return sqliteBitOr(column, bits);
    default:
      throw new Error(`bitOr not implemented for ${dbType}`);
  }
}

/**
 * Convert a json value returned by the database into a javascript
 * object.  For postgres, the value is already unpacked, but for sqlite
 * it is a string.
 */
export function readJson(dbType: DatabaseType, selection: any) {
  switch (dbType) {
    case 'postgres':
      return selection;
    case 'sqlite':
      return JSON.parse(selection);
    default:
      throw new Error(`readJson not implemented for ${dbType}`);
  }
}

export function now(dbType: DatabaseType) {
  switch (dbType) {
    case 'postgres':
      return 'now()';
    case 'sqlite':
      return "datetime('now')";
    default:
      throw new Error(`now not implemented for ${dbType}`);
  }
}

// Understands strings like: "-30 days" or "1 year"
export function fromNow(dbType: DatabaseType, relative: string) {
  switch (dbType) {
    case 'postgres':
      return `(now() + interval '${relative}')`;
    case 'sqlite':
      return `datetime('now','${relative}')`;
    default:
      throw new Error(`fromNow not implemented for ${dbType}`);
  }
}

export function datetime(dbType: DatabaseType) {
  switch (dbType) {
    case 'postgres':
      return 'timestamp with time zone';
    case 'sqlite':
      return "datetime";
    default:
      throw new Error(`now not implemented for ${dbType}`);
  }
}
