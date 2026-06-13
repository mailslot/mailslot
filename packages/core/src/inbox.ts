import { Agent, type AgentEmail } from "agents";
import PostalMime from "postal-mime";
import type { Env } from "./env";
import { extractLinks, extractOtp, htmlToText, makeSnippet } from "./extract";

export type MessageSummary = {
  id: string;
  from: string;
  subject: string;
  snippet: string;
  receivedAt: number;
  consumed: boolean;
};

export type MessageDetail = MessageSummary & {
  text: string;
  html: string;
  rawKey: string;
};

type MessageRow = {
  id: string;
  from_addr: string;
  subject: string;
  snippet: string;
  text_body: string;
  html_body: string;
  raw_key: string;
  received_at: number;
  consumed_at: number | null;
};

export type ListOptions = {
  limit?: number;
  q?: string;
  fromContains?: string;
  subjectContains?: string;
};

export type WaitOptions = {
  timeoutMs?: number;
  /** Only match messages received in the last N seconds (default 60) or later. */
  sinceSecondsAgo?: number;
  fromContains?: string;
  subjectContains?: string;
};

const MAX_WAIT_MS = 120_000;
const WAIT_POLL_MS = 1_000;
const WEBHOOK_MAX_ATTEMPTS = 3;

/**
 * One Durable Object per email address. Instance name = lowercased address.
 * Receives mail via routeAgentEmail → onEmail, exposes read tools over RPC.
 */
export class Inbox extends Agent<Env> {
  onStart() {
    this.sql`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        from_addr TEXT NOT NULL,
        subject TEXT NOT NULL DEFAULT '',
        snippet TEXT NOT NULL DEFAULT '',
        text_body TEXT NOT NULL DEFAULT '',
        html_body TEXT NOT NULL DEFAULT '',
        raw_key TEXT NOT NULL,
        received_at INTEGER NOT NULL,
        consumed_at INTEGER
      )
    `;
    this.sql`CREATE INDEX IF NOT EXISTS idx_messages_received ON messages (received_at DESC)`;
  }

  /** The address this inbox serves (the DO instance name). */
  get address(): string {
    return this.name;
  }

  async onEmail(email: AgentEmail) {
    const raw = await email.getRaw();
    const parsed = await PostalMime.parse(raw);

    const id = crypto.randomUUID();
    const receivedAt = Date.now();
    const subject = parsed.subject ?? "";
    const text = parsed.text ?? "";
    const html = parsed.html ?? "";
    const snippet = makeSnippet(text, html);
    const rawKey = `raw/${this.address}/${id}.eml`;

    await this.env.RAW.put(rawKey, raw);
    this.sql`
      INSERT INTO messages (id, from_addr, subject, snippet, text_body, html_body, raw_key, received_at)
      VALUES (${id}, ${email.from}, ${subject}, ${snippet}, ${text}, ${html}, ${rawKey}, ${receivedAt})
    `;

    // Forward decision must happen here: the email proxy is only valid
    // during this invocation.
    if (this.env.FORWARD_MODE === "all" && this.env.FORWARD_TO) {
      try {
        await email.forward(this.env.FORWARD_TO);
      } catch (e) {
        console.error(`forward to ${this.env.FORWARD_TO} failed:`, e);
      }
    }

    // Extension point: subclasses may add custom handling (e.g. an auto-reply)
    // here, while the email proxy is still valid and before webhook delivery.
    await this.onStored(email, { id, from: email.from, subject, snippet, receivedAt, consumed: false });

    if (this.env.WEBHOOK_URL) {
      await this.deliverWebhook({
        v: 1,
        event: "message.received",
        inbox: this.address,
        message: {
          id,
          from: email.from,
          subject,
          snippet,
          receivedAt
        }
      });
    }
  }

  /**
   * Extension point, called once per inbound message after it is stored and
   * any forward, before webhook delivery — while the email proxy is still
   * valid. Default: no-op. Override in a subclass to add custom handling such
   * as an auto-reply. Core stays free of outbound/business logic.
   */
  protected async onStored(_email: AgentEmail, _message: MessageSummary): Promise<void> {}

  list(opts: ListOptions = {}): MessageSummary[] {
    const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);
    // Small per-address volumes: fetch recent window, filter in JS.
    const rows = this.sql<MessageRow>`
      SELECT * FROM messages ORDER BY received_at DESC LIMIT 200
    `;
    const match = (row: MessageRow) => {
      const q = opts.q?.toLowerCase();
      if (
        q &&
        !row.subject.toLowerCase().includes(q) &&
        !row.from_addr.toLowerCase().includes(q) &&
        !row.text_body.toLowerCase().includes(q)
      )
        return false;
      if (opts.fromContains && !row.from_addr.toLowerCase().includes(opts.fromContains.toLowerCase()))
        return false;
      if (opts.subjectContains && !row.subject.toLowerCase().includes(opts.subjectContains.toLowerCase()))
        return false;
      return true;
    };
    return rows.filter(match).slice(0, limit).map(toSummary);
  }

  get(id: string): MessageDetail | null {
    const rows = this.sql<MessageRow>`SELECT * FROM messages WHERE id = ${id}`;
    const row = rows[0];
    return row ? toDetail(row) : null;
  }

  /**
   * Extract an OTP. Read-once: succeeds at most once per message.
   * Without messageId, uses the newest unconsumed message.
   */
  extractOtp(messageId?: string): { otp: string | null; messageId: string | null; error?: string } {
    const row = messageId
      ? this.sql<MessageRow>`SELECT * FROM messages WHERE id = ${messageId}`[0]
      : this.sql<MessageRow>`
          SELECT * FROM messages WHERE consumed_at IS NULL ORDER BY received_at DESC LIMIT 1
        `[0];

    if (!row) {
      return { otp: null, messageId: messageId ?? null, error: messageId ? "message not found" : "no unconsumed messages" };
    }
    if (row.consumed_at !== null) {
      return { otp: null, messageId: row.id, error: "already consumed (read-once)" };
    }

    const body = row.text_body || htmlToText(row.html_body);
    const otp = extractOtp(row.subject, body);
    if (!otp) {
      return { otp: null, messageId: row.id, error: "no OTP-like code found" };
    }

    this.sql`UPDATE messages SET consumed_at = ${Date.now()} WHERE id = ${row.id}`;
    return { otp, messageId: row.id };
  }

  extractLinks(messageId?: string): { links: string[]; messageId: string | null; error?: string } {
    const row = messageId
      ? this.sql<MessageRow>`SELECT * FROM messages WHERE id = ${messageId}`[0]
      : this.sql<MessageRow>`SELECT * FROM messages ORDER BY received_at DESC LIMIT 1`[0];
    if (!row) {
      return { links: [], messageId: messageId ?? null, error: messageId ? "message not found" : "inbox is empty" };
    }
    return { links: extractLinks(row.text_body, row.html_body), messageId: row.id };
  }

  /** Long-poll for a matching message. Returns null on timeout. */
  async waitForMessage(opts: WaitOptions = {}): Promise<MessageSummary | null> {
    const timeoutMs = Math.min(Math.max(opts.timeoutMs ?? 60_000, 1_000), MAX_WAIT_MS);
    const sinceTs = Date.now() - (opts.sinceSecondsAgo ?? 60) * 1000;
    const deadline = Date.now() + timeoutMs;

    while (true) {
      const rows = this.sql<MessageRow>`
        SELECT * FROM messages WHERE received_at >= ${sinceTs} ORDER BY received_at DESC LIMIT 50
      `;
      const hit = rows.find((row) => {
        if (opts.fromContains && !row.from_addr.toLowerCase().includes(opts.fromContains.toLowerCase()))
          return false;
        if (opts.subjectContains && !row.subject.toLowerCase().includes(opts.subjectContains.toLowerCase()))
          return false;
        return true;
      });
      if (hit) return toSummary(hit);
      if (Date.now() + WAIT_POLL_MS > deadline) return null;
      await new Promise((r) => setTimeout(r, WAIT_POLL_MS));
    }
  }

  info(): { address: string; messageCount: number } {
    const rows = this.sql<{ n: number }>`SELECT COUNT(*) AS n FROM messages`;
    return { address: this.address, messageCount: rows[0]?.n ?? 0 };
  }

  // --- webhook delivery -----------------------------------------------------

  private async deliverWebhook(payload: Record<string, unknown>, attempt = 1) {
    const url = this.env.WEBHOOK_URL;
    if (!url) return;
    const body = JSON.stringify(payload);
    try {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (this.env.WEBHOOK_SECRET) {
        headers["x-mailslot-signature"] = await hmacHex(this.env.WEBHOOK_SECRET, body);
      }
      const res = await fetch(url, { method: "POST", headers, body });
      if (!res.ok) throw new Error(`webhook responded ${res.status}`);
    } catch (e) {
      console.error(`webhook attempt ${attempt} failed:`, e);
      if (attempt < WEBHOOK_MAX_ATTEMPTS) {
        await this.schedule(30 * attempt, "retryWebhook", { payload, attempt: attempt + 1 });
      }
    }
  }

  /** Scheduled-task callback for webhook retries (must be public for schedule()). */
  async retryWebhook(data: { payload: Record<string, unknown>; attempt: number }) {
    await this.deliverWebhook(data.payload, data.attempt);
  }
}

function toSummary(row: MessageRow): MessageSummary {
  return {
    id: row.id,
    from: row.from_addr,
    subject: row.subject,
    snippet: row.snippet,
    receivedAt: row.received_at,
    consumed: row.consumed_at !== null
  };
}

function toDetail(row: MessageRow): MessageDetail {
  return {
    ...toSummary(row),
    text: row.text_body,
    html: row.html_body,
    rawKey: row.raw_key
  };
}

async function hmacHex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
