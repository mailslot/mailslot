/** Constant-time bearer token check (compares SHA-256 digests). */
export async function checkBearerToken(request: Request, expected: string | undefined): Promise<boolean> {
  if (!expected) return false; // unset token = locked, never open
  const header = request.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return false;

  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(match[1])),
    crypto.subtle.digest("SHA-256", enc.encode(expected))
  ]);
  return timingSafeEqual(new Uint8Array(a), new Uint8Array(b));
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** Mint a random address local part: prefix-x7k2f9 (lowercase, unambiguous). */
export function mintLocalPart(prefix?: string): string {
  const safePrefix = (prefix ?? "agent").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 20) || "agent";
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789"; // no 0/o/1/l/i
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  let suffix = "";
  for (const byte of bytes) suffix += alphabet[byte % alphabet.length];
  return `${safePrefix}-${suffix}`;
}
