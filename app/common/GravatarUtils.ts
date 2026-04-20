const md5 = require('blueimp-md5');

export function getGravatarUrl(email: string, size: number = 200): string {
  const normalizedEmail = email.trim().toLowerCase();
  const hash = md5(normalizedEmail);
  return `https://www.gravatar.com/avatar/${hash}?s=${size}&d=identicon`;
}