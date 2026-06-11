const API = "https://api.cloudflare.com/client/v4";

async function cf(token, path, init = {}) {
  const res = await fetch(API + path, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...init.headers
    }
  });
  const body = await res.json().catch(() => null);
  if (!body?.success) {
    const msg = body?.errors?.map((e) => e.message).join("; ") || `HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return body.result;
}

export async function zoneId(token, zoneName) {
  const zones = await cf(token, `/zones?name=${encodeURIComponent(zoneName)}`);
  return zones?.[0]?.id ?? null;
}

export function routingStatus(token, zid) {
  return cf(token, `/zones/${zid}/email/routing`);
}

/** Enable Email Routing on the zone apex (adds MX/SPF). Best-effort. */
export function enableRouting(token, zid) {
  return cf(token, `/zones/${zid}/email/routing/enable`, { method: "POST" });
}

/** Point the zone's catch-all rule at a Worker. */
export function setCatchAllToWorker(token, zid, workerName) {
  return cf(token, `/zones/${zid}/email/routing/rules/catch_all`, {
    method: "PUT",
    body: JSON.stringify({
      name: "mailslot catch-all",
      enabled: true,
      matchers: [{ type: "all" }],
      actions: [{ type: "worker", value: [workerName] }]
    })
  });
}
