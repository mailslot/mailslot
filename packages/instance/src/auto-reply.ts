import type { AgentEmail, MessageSummary } from "@mailslot/core";

// Pure helpers for the return-receipt feature. Type-only imports keep this
// module free of the worker/agents runtime so it can be unit-tested directly.

/**
 * Loop prevention. Never answer bounces, auto-generated, or bulk/list mail —
 * replying to a robot is how mail loops are born.
 */
export function shouldAutoReply(email: AgentEmail): boolean {
  const from = (email.from ?? "").toLowerCase();
  if (!from || from.startsWith("mailer-daemon") || from.startsWith("postmaster")) return false;

  const h = email.headers;
  const autoSubmitted = h.get("auto-submitted");
  if (autoSubmitted && autoSubmitted.toLowerCase() !== "no") return false;
  if (h.get("x-auto-response-suppress")) return false;
  if (h.get("list-id") || h.get("list-unsubscribe")) return false;
  const precedence = (h.get("precedence") ?? "").toLowerCase();
  if (precedence === "bulk" || precedence === "junk" || precedence === "list") return false;
  return true;
}

export function receiptBody(address: string, msg: MessageSummary): string {
  return [
    "Return receipt — your mail was handled by a Mailslot worker.",
    "",
    `  inbox:    ${address}`,
    `  subject:  ${msg.subject || "(none)"}`,
    `  parsed:   ${msg.snippet || "(empty body)"}`,
    `  id:       ${msg.id}`,
    `  received: ${new Date(msg.receivedAt).toISOString()}`,
    "",
    "This reply was sent by the same Cloudflare Worker that received,",
    "parsed, and stored your message — self-hosted, no email provider",
    "involved. An AI agent can now read it over MCP.",
    "",
    "Mailslot — your agent's email shouldn't come with a landlord.",
    "https://mailslot.dev · https://github.com/mailslot/mailslot"
  ].join("\n");
}
