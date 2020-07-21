/**
 *
 * Utilities related to email normalization.  Currently
 * trivial, but could potentially need special per-domain
 * rules in future.
 *
 * Email addresses are a bit slippery.  Domain names are
 * case insensitive, but user names may or may not be,
 * depending on the mail server handling the domain.
 * Other special treatment of user names may also be in
 * place for particular domains (periods, plus sign, etc).
 *
 * We treat emails as case-insensitive for the purposes
 * of determining equality of emails, and indexing users
 * by email address.
 *
 */

/**
 *
 * Convert the supplied email address to a normalized form
 * that we will use for indexing and equality tests.
 * Many possible email addresses could map to the same
 * normalized result; as far as we are concerned those
 * addresses are equivalent.
 *
 * The normalization we do is a simple lowercase.  This
 * means we won't be able to treat both Jane@x.y and
 * jane@x.y as separate email addresses, even through
 * they may in fact be separate mailboxes on x.y.
 *
 * The normalized email is not something we should show
 * the user in the UI, but is rather for internal purposes.
 *
 * The original non-normalized email is called a
 * "display email" to distinguish it from a "normalized
 * email"
 *
 */
export function normalizeEmail(displayEmail: string): string {
  // We take the lower case, without use of locale.
  return displayEmail.toLowerCase();
}
