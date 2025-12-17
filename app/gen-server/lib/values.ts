/**
 * This smoothes over some awkward differences between TypeORM treatment of
 * booleans and json in sqlite and postgres.  Booleans and json work fine
 * with each db, but have different levels of driver-level support.
 */

export interface NativeValues {
  // Json and jsonb columns are handled natively by the postgres driver, but for
  // sqlite requires a typeorm wrapper (simple-json).
  jsonEntityType: 'json' | 'simple-json';
  jsonbEntityType: 'jsonb' | 'simple-json';
  jsonType: 'json' | 'varchar';
  jsonbType: 'jsonb' | 'varchar';
  booleanType: 'boolean' | 'integer';
  dateTimeType: 'timestamp with time zone' | 'datetime';
  trueValue: boolean | number;
  falseValue: boolean | number;
}

const sqliteNativeValues: NativeValues = {
  jsonEntityType: 'simple-json',
  jsonbEntityType: 'simple-json',
  jsonType: 'varchar',
  jsonbType: 'varchar',
  booleanType: 'integer',
  dateTimeType: 'datetime',
  trueValue: 1,
  falseValue: 0
};

const postgresNativeValues: NativeValues = {
  jsonEntityType: 'json',
  jsonbEntityType: 'jsonb',
  jsonType: 'json',
  jsonbType: 'jsonb',
  booleanType: 'boolean',
  dateTimeType: 'timestamp with time zone',
  trueValue: true,
  falseValue: false
};

export const nativeValues = (process.env.TYPEORM_TYPE === 'postgres') ? postgresNativeValues : sqliteNativeValues;
