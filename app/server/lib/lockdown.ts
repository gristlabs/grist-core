/**
 * Hardens this realm against prototype pollution. Import it first in every entry realm (server
 * and CLI entry points, worker threads, standalone scripts); new threads and forked children
 * don't inherit it.
 *
 * Prototype pollution is untrusted input reaching Object.prototype, typically through code like
 * `obj[key1][key2] = value` with attacker-chosen keys, and adding a property that every object
 * then inherits (e.g. `isAdmin`). We make two changes:
 *
 *   - `__proto__` is removed, as node's --disable-proto=delete does: reads return undefined and
 *     writes create an ordinary own property, so an untrusted key can neither reach
 *     Object.prototype nor re-parent the object it lands on.
 *   - Object.prototype it is made non-extensible, so adding a property to it throws (in strict
 *     code) or is ignored.
 *
 * We don't freeze Object.prototype or other intrinsics at this point, since that interferes with
 * some libraries and with V8's fast paths for various operations.
 */

// This has the same effect as --disable-proto=delete. But we still use the flag externally, as
// that applies to all realms (e.g. threads), rather than only those that remember this import.
Reflect.deleteProperty(Object.prototype, "__proto__");

Object.preventExtensions(Object.prototype);
