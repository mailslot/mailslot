import { Inbox as CoreInbox, MailslotMcp, type MessageSummary, type AgentEmail } from "@mailslot/core";
import worker from "@mailslot/core";
import { shouldAutoReply, receiptBody } from "./auto-reply";

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
