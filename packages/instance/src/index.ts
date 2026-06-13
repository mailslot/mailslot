import { Inbox as CoreInbox, MailslotMcp, type MessageSummary, type AgentEmail } from "@mailslot/core";
import worker from "@mailslot/core";

declare global {
  namespace Cloudflare {
    interface Env {
      /**
       * Comma-separated addresses that auto-reply with a "return receipt"
       * showing what the worker parsed. Set as a dashboard var; survives
       * deploys via keep_vars. Replies are suppressed for auto-generated,
       * bulk, and bounce mail. Instance-only — not in @mailslot/core.
       */
      RECEIPT_ADDRESSES?: string;
    }
  }
}

/**
 * The live mailslot.dev worker. Structurally identical to a `create-mailslot`
 * deployment — it installs @mailslot/core and re-exports its worker — plus one
 * custom behavior: a return-receipt auto-reply that proves the worker handled
 * inbound mail. The reply logic and the mailslot.dev branding live only here
 * and are never published to @mailslot/core. This file doubles as the worked
 * example of how to customize a deployment via the `onStored` hook.
 */
export class Inbox extends CoreInbox {
  protected async onStored(email: AgentEmail, msg: MessageSummary): Promise<void> {
    if (!this.isReceiptAddress() || !shouldAutoReply(email)) return;
    try {
      await this.replyToEmail(email, {
        fromName: "Mailslot",
        body: receiptBody(this.address, msg)
      });
    } catch (e) {
      console.error("receipt reply failed:", e);
    }
  }

  /** Addresses in RECEIPT_ADDRESSES auto-reply with a return receipt. */
  private isReceiptAddress(): boolean {
    return (this.env.RECEIPT_ADDRESSES ?? "")
      .split(",")
      .map((a) => a.trim().toLowerCase())
      .filter(Boolean)
      .includes(this.address);
  }
}

export { MailslotMcp };
export default worker;

/**
 * Loop prevention. Never answer bounces, auto-generated, or bulk/list mail —
 * replying to a robot is how mail loops are born.
 */
function shouldAutoReply(email: AgentEmail): boolean {
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

function receiptBody(address: string, msg: MessageSummary): string {
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
