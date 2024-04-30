/**
 * We allow alphanumeric characters and certain common whitelisted characters (except at the start),
 * plus everything non-ASCII (for non-English alphabets, which we want to allow but it's hard to be
 * more precise about what exactly to allow).
 */
// eslint-disable-next-line no-control-regex
const VALID_NAME_REGEXP = /^(\w|[^\u0000-\u007F])(\w|[- ./'"()]|[^\u0000-\u007F])*$/;

/**
 * Test name against various rules to check if it is a valid username.
 */
export function checkName(name: string): boolean {
  return VALID_NAME_REGEXP.test(name);
}
