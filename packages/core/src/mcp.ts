import { getAgentByName } from "agents";
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "./env";
import { mintLocalPart } from "./auth";

const ADDRESS = z.string().email().describe("Full inbox address, e.g. agent-x7k2f9@agents.example.com");

/**
 * MCP surface. Tools are thin wrappers over Inbox DO RPC — the same engine
 * the HTTP API uses. One stateless server; inbox state lives in Inbox DOs.
 */
export class MailslotMcp extends McpAgent<Env> {
  server = new McpServer({ name: "mailslot", version: "0.0.1" });

  async init() {
    const env = this.env;

    const inbox = (address: string) => getAgentByName(env.Inbox, address.toLowerCase());
    const json = (value: unknown) => ({
      content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }]
    });

    this.server.registerTool(
      "create_address",
      {
        description:
          "Mint a fresh, never-used email address for a task. Use one address per signup/task; do not reuse.",
        inputSchema: {
          prefix: z.string().optional().describe("Optional address prefix, e.g. 'signup' → signup-x7k2f9@…")
        }
      },
      async ({ prefix }) => {
        if (!env.EMAIL_DOMAIN) return json({ error: "EMAIL_DOMAIN is not configured on the server" });
        return json({ address: `${mintLocalPart(prefix)}@${env.EMAIL_DOMAIN.toLowerCase()}` });
      }
    );

    this.server.registerTool(
      "list_messages",
      {
        description: "List recent messages in an inbox, newest first. Optional substring filters.",
        inputSchema: {
          address: ADDRESS,
          q: z.string().optional().describe("Match in subject, sender, or body"),
          from_contains: z.string().optional(),
          subject_contains: z.string().optional(),
          limit: z.number().int().min(1).max(100).optional()
        }
      },
      async ({ address, q, from_contains, subject_contains, limit }) => {
        const stub = await inbox(address);
        return json(await stub.list({ q, fromContains: from_contains, subjectContains: subject_contains, limit }));
      }
    );

    this.server.registerTool(
      "get_message",
      {
        description: "Fetch a full message (text, HTML, headers reference) by id.",
        inputSchema: { address: ADDRESS, message_id: z.string() }
      },
      async ({ address, message_id }) => {
        const stub = await inbox(address);
        const message = await stub.get(message_id);
        return json(message ?? { error: "message not found" });
      }
    );

    this.server.registerTool(
      "extract_otp",
      {
        description:
          "Extract the one-time code from a message. READ-ONCE: each message yields its OTP at most once. " +
          "Omit message_id to use the newest unconsumed message.",
        inputSchema: { address: ADDRESS, message_id: z.string().optional() }
      },
      async ({ address, message_id }) => {
        const stub = await inbox(address);
        return json(await stub.extractOtp(message_id));
      }
    );

    this.server.registerTool(
      "extract_links",
      {
        description:
          "Extract links (verification/magic links first, by document order) from a message. " +
          "Omit message_id to use the newest message.",
        inputSchema: { address: ADDRESS, message_id: z.string().optional() }
      },
      async ({ address, message_id }) => {
        const stub = await inbox(address);
        return json(await stub.extractLinks(message_id));
      }
    );

    this.server.registerTool(
      "wait_for_message",
      {
        description:
          "Block until a matching message arrives (long-poll), or timeout. Call right after triggering the email " +
          "(signup, password reset). Returns the message summary, or null on timeout.",
        inputSchema: {
          address: ADDRESS,
          timeout_s: z.number().int().min(1).max(120).optional().describe("Default 60"),
          since_s: z.number().int().min(0).optional().describe("Also match messages up to N seconds old (default 60)"),
          from_contains: z.string().optional(),
          subject_contains: z.string().optional()
        }
      },
      async ({ address, timeout_s, since_s, from_contains, subject_contains }) => {
        const stub = await inbox(address);
        const message = await stub.waitForMessage({
          timeoutMs: (timeout_s ?? 60) * 1000,
          sinceSecondsAgo: since_s,
          fromContains: from_contains,
          subjectContains: subject_contains
        });
        return json({ message });
      }
    );
  }
}
