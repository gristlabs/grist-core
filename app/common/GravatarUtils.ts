export async function getGravatarUrl(email: string, size: number = 200): Promise<string> {
  const normalizedEmail = email.trim().toLowerCase();
  const enc = new TextEncoder();
  const hashAsArrayBuffer = await crypto.subtle.digest("SHA-256", enc.encode(normalizedEmail));
  const uint8ViewOfHash = new Uint8Array(hashAsArrayBuffer);
  const hash = Array.from(uint8ViewOfHash)
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
  return `https://www.gravatar.com/avatar/${hash}?s=${size}&d=identicon`;
}
