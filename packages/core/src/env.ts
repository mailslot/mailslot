import type { Inbox } from "./inbox";

declare global {
  namespace Cloudflare {
    interface Env {
      Inbox: DurableObjectNamespace<Inbox>;
      MailslotMcp: DurableObjectNamespace;
      RAW: R2Bucket;
      /** Bearer token for the HTTP API and MCP endpoint (secret). */
      MAILSLOT_TOKEN: string;
      /** Domain receiving agent mail, e.g. agents.example.com. */
      EMAIL_DOMAIN?: string;
      /** Verified Email Routing destination to forward copies to. */
      FORWARD_TO?: string;
      /** "all" forwards every inbound message to FORWARD_TO; default "none". */
      FORWARD_MODE?: string;
      /** URL receiving message.received webhook events. */
      WEBHOOK_URL?: string;
      /** If set, webhook payloads are HMAC-SHA256 signed (X-Mailslot-Signature). */
      WEBHOOK_SECRET?: string;
      /**
       * Comma-separated addresses that auto-reply with a "return receipt"
       * showing what the worker parsed (proof-of-handling). Replies are
       * suppressed for auto-generated, bulk, and bounce mail.
       */
      RECEIPT_ADDRESSES?: string;
    }
  }
}

export type Env = Cloudflare.Env;
