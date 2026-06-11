import { routeAgentEmail } from "agents";
import type { Env } from "./env";
import { Inbox } from "./inbox";
import { MailslotMcp } from "./mcp";
import { handleApi } from "./api";
import { checkBearerToken } from "./auth";

export { Inbox, MailslotMcp };

const mcpHandler = MailslotMcp.serve("/mcp", { binding: "MailslotMcp" });

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/v1/health") {
      return Response.json({ ok: true, service: "mailslot" });
    }

    const authorized = await checkBearerToken(request, env.MAILSLOT_TOKEN);
    if (!authorized) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }

    if (url.pathname === "/mcp" || url.pathname.startsWith("/mcp/")) {
      return mcpHandler.fetch(request, env, ctx);
    }
    if (url.pathname.startsWith("/v1/")) {
      return handleApi(request, env);
    }
    return Response.json({ error: "not found" }, { status: 404 });
  },

  async email(message: ForwardableEmailMessage, env: Env) {
    await routeAgentEmail(message, env, {
      // Catch-all: every address on the domain gets its own Inbox DO,
      // named by the full lowercased recipient address.
      resolver: async (email: ForwardableEmailMessage) => {
        const to = email.to?.toLowerCase();
        if (!to || !isAcceptableAddress(to, env.EMAIL_DOMAIN)) {
          email.setReject("Unknown recipient");
          return null;
        }
        return { agentName: "Inbox", agentId: to };
      }
    });
  }
} satisfies ExportedHandler<Env>;

function isAcceptableAddress(to: string, domain?: string): boolean {
  const at = to.lastIndexOf("@");
  if (at < 1) return false;
  const local = to.slice(0, at);
  if (local.length > 64) return false;
  // If EMAIL_DOMAIN is configured, only accept mail for that domain.
  if (domain && to.slice(at + 1) !== domain.toLowerCase()) return false;
  return true;
}
