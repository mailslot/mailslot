import { getAgentByName } from "agents";
import type { Env } from "./env";
import { mintLocalPart } from "./auth";

/**
 * Plain HTTP surface mirroring the MCP tools.
 *
 *   POST /v1/addresses                                  {prefix?}
 *   GET  /v1/inboxes/:address/messages                  ?q&from_contains&subject_contains&limit
 *   GET  /v1/inboxes/:address/messages/:id
 *   POST /v1/inboxes/:address/extract-otp               {message_id?}
 *   POST /v1/inboxes/:address/extract-links             {message_id?}
 *   GET  /v1/inboxes/:address/wait                      ?timeout_s&since_s&from_contains&subject_contains
 */
export async function handleApi(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const parts = url.pathname.split("/").filter(Boolean); // ["v1", ...]

  try {
    if (parts[1] === "addresses" && request.method === "POST") {
      if (!env.EMAIL_DOMAIN) {
        return Response.json({ error: "EMAIL_DOMAIN is not configured" }, { status: 500 });
      }
      const body = await readJson(request);
      const address = `${mintLocalPart(body.prefix)}@${env.EMAIL_DOMAIN.toLowerCase()}`;
      return Response.json({ address }, { status: 201 });
    }

    if (parts[1] === "inboxes" && parts[2]) {
      const address = decodeURIComponent(parts[2]).toLowerCase();
      if (!address.includes("@")) {
        return Response.json({ error: "address must be a full email address" }, { status: 400 });
      }
      const inbox = await getAgentByName(env.Inbox, address);
      const rest = parts.slice(3);

      if (rest[0] === "messages" && !rest[1] && request.method === "GET") {
        const messages = await inbox.list({
          q: url.searchParams.get("q") ?? undefined,
          fromContains: url.searchParams.get("from_contains") ?? undefined,
          subjectContains: url.searchParams.get("subject_contains") ?? undefined,
          limit: numParam(url, "limit")
        });
        return Response.json({ messages });
      }

      if (rest[0] === "messages" && rest[1] && request.method === "GET") {
        const message = await inbox.get(rest[1]);
        return message
          ? Response.json({ message })
          : Response.json({ error: "message not found" }, { status: 404 });
      }

      if (rest[0] === "extract-otp" && request.method === "POST") {
        const body = await readJson(request);
        return Response.json(await inbox.extractOtp(body.message_id));
      }

      if (rest[0] === "extract-links" && request.method === "POST") {
        const body = await readJson(request);
        return Response.json(await inbox.extractLinks(body.message_id));
      }

      if (rest[0] === "wait" && request.method === "GET") {
        const message = await inbox.waitForMessage({
          timeoutMs: (numParam(url, "timeout_s") ?? 60) * 1000,
          sinceSecondsAgo: numParam(url, "since_s"),
          fromContains: url.searchParams.get("from_contains") ?? undefined,
          subjectContains: url.searchParams.get("subject_contains") ?? undefined
        });
        return Response.json({ message }); // message: null on timeout
      }
    }

    return Response.json({ error: "not found" }, { status: 404 });
  } catch (e) {
    console.error("api error:", e);
    return Response.json({ error: "internal error" }, { status: 500 });
  }
}

async function readJson(request: Request): Promise<Record<string, string | undefined>> {
  try {
    const body = await request.json();
    return typeof body === "object" && body !== null ? (body as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function numParam(url: URL, name: string): number | undefined {
  const value = url.searchParams.get(name);
  if (value === null) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}
