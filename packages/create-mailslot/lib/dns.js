const DOH = "https://cloudflare-dns.com/dns-query";
const TYPE_IDS = { A: 1, NS: 2, MX: 15 };

/** Resolve via DNS-over-HTTPS (no system dig dependency). */
export async function dohResolve(name, type) {
  const res = await fetch(`${DOH}?name=${encodeURIComponent(name)}&type=${type}`, {
    headers: { accept: "application/dns-json" }
  });
  if (!res.ok) throw new Error(`DNS lookup failed (${res.status})`);
  const data = await res.json();
  return (data.Answer ?? [])
    .filter((a) => a.type === TYPE_IDS[type])
    .map((a) => String(a.data).toLowerCase());
}

export const mxRecords = (domain, resolve = dohResolve) => resolve(domain, "MX");

export function isCloudflareMx(records) {
  return records.some((r) => r.includes("mx.cloudflare.net"));
}

export function isCloudflareNs(records) {
  return records.some((r) => r.includes("ns.cloudflare.com"));
}

/**
 * Zone-level Email Routing state, inferred from the APEX MX records.
 *
 * Email Routing is a zone-level feature: subdomains can only be enrolled
 * AFTER the zone has Email Routing enabled, and enabling it requires
 * Cloudflare to own the apex MX. Consequences:
 *   "cloudflare" — routing enabled; apex and subdomains both usable
 *   "none"       — no mail yet; routing can be enabled cleanly
 *   "foreign"    — apex mail lives elsewhere (Google/Lark/O365…); the zone
 *                  CANNOT be used for Mailslot — not even via a subdomain —
 *                  without deleting the provider's MX (breaking that mail)
 */
export function zoneRoutingState(apexMxRecords) {
  if (apexMxRecords.length === 0) return "none";
  return isCloudflareMx(apexMxRecords) ? "cloudflare" : "foreign";
}

/**
 * Walk labels upward until a zone apex (has NS records) is found.
 * mail.foo.example.com → example.com (where NS answers).
 */
export async function findZone(domain, resolve = dohResolve) {
  const labels = domain.split(".").filter(Boolean);
  for (let i = 0; i <= labels.length - 2; i++) {
    const candidate = labels.slice(i).join(".");
    const ns = await resolve(candidate, "NS");
    if (ns.length > 0) return { zone: candidate, ns };
  }
  return null;
}

/** Poll until the domain's MX records point at Cloudflare, or time out. */
export async function waitForCloudflareMx(domain, { timeoutMs = 300_000, intervalMs = 5_000, onTick } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const mx = await mxRecords(domain).catch(() => []);
    if (isCloudflareMx(mx)) return true;
    onTick?.();
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}
