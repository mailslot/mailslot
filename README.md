# Mailslot

**Self-hosted email inbox for AI agents — on your own Cloudflare account, on
your own domain.** The open-source alternative to hosted agent-email APIs.

> Your agent's email shouldn't come with a landlord.

```
┌─────────────────────────── your Cloudflare account ───────────────────────────┐
│                                                                                │
│  any sender ──▶ Email Routing ──▶ one Durable Object per address               │
│                                      │  parse · store · read-once state        │
│                                      ├──▶ MCP server   ◀── Claude / OpenClaw   │
│                                      ├──▶ HTTP API     ◀── your code           │
│                                      ├──▶ webhook      ──▶ n8n / Make          │
│                                      └──▶ forward()    ──▶ your real inbox     │
│                                                                                │
└── nobody else's servers. nobody else's eyes. ──────────────────────────────────┘
```

## Why

Give an agent real work and it eventually needs to receive email. Sign up
for a service — verification link. Log in — OTP. Register an account, reset
a password, collect an invoice: the loop always closes through an inbox.

Across the automation and agent systems I've worked on, the same wall comes
up every time: the agent is fully capable of the task, then stalls at "check
your email." And the existing options are both bad — hand the agent
credentials to your personal Gmail, or rent an inbox from a hosted API that
reads everything passing through it.

Mailslot is the third option: your agent's inbox, deployed to **your**
Cloudflare account in about ten minutes. Inbound mail lands on your domain,
is parsed and stored on your infrastructure, and is readable only by your
agents. The privacy story isn't a policy. In fact, it's the architecture. We
could not read your mail if we wanted to. There is no "we."

## What your agent can do

| Tool | What it does |
|---|---|
| `list` / `search` | Browse and filter messages (sender, subject, time) |
| `get` | Fetch a full message (text, HTML, headers) |
| `extract_otp` | Pull the verification code out of a message — **read-once** |
| `extract_links` | Pull magic links / verification URLs |
| `wait_for_message` | Block until matching mail arrives (or timeout) |
| `create_address` | Mint a fresh address on demand — one per task, never reused |

Exposed three ways, same engine:

- **MCP server** — point Claude, OpenClaw, or any MCP client at it
- **HTTP API** — token-auth REST for your own code
- **Webhooks** — `message.received` pushed to n8n, Make, or anything with a URL

## Quick start

```sh
npx create-mailslot
```

Ten minutes, interactively: scaffolds a project **you own**, provisions
storage and an API token, deploys the worker, walks Email Routing setup
(Cloudflare API token or guided dashboard steps with live DNS verification),
and finishes with a live round-trip — send an email from your phone, watch
it arrive in your terminal. Flags for non-interactive use are in the
[wizard's README](packages/create-mailslot/README.md).

Requirements: Node 18+, a Cloudflare account (free tier works), and a domain
on Cloudflare.

> ⚠️ **Domain reality check (the wizard enforces this):** Email Routing is
> zone-level. If a domain's apex already receives mail elsewhere (Google
> Workspace, Lark, O365…), that domain can't host Mailslot at all — not
> even on a subdomain — without breaking its existing mail. Use a separate
> domain. (Subdomains work fine on zones where Email Routing is already
> enabled.)

<details>
<summary><b>Manual setup</b> (what the wizard automates)</summary>

```sh
git clone https://github.com/mailslot/mailslot && cd mailslot && npm install
cd packages/core

# 1. Storage + auth (one-time)
npx wrangler r2 bucket create mailslot-raw
openssl rand -hex 24 | npx wrangler secret put MAILSLOT_TOKEN   # keep a copy!

# 2. Deploy, baking in your mail domain (persists across future deploys)
npx wrangler deploy --var EMAIL_DOMAIN:mail.example.com
```

3. **Enable Email Routing** on your domain in the Cloudflare dashboard
   (zone → Email Routing), respecting the domain reality check above.

4. **Point mail at the worker**: Email Routing → Routing rules →
   **Catch-all** → action *Send to a Worker* → `mailslot` → **Enabled**.

5. Round-trip test:

```sh
TOKEN=<your token>
WORKER=https://mailslot.<your-subdomain>.workers.dev

# mint an address, send any email to it, then:
curl -s "$WORKER/v1/inboxes/<address>/wait?timeout_s=90" \
  -H "Authorization: Bearer $TOKEN"
```

</details>

Config lives in two instance-specific values that survive every deploy
(`keep_vars`): `EMAIL_DOMAIN` (var — dashboard-editable) and `MAILSLOT_TOKEN`
(secret). The repo's `wrangler.jsonc` stays generic. Optional: `FORWARD_TO` +
`FORWARD_MODE=all` (copy mail to a verified address), `WEBHOOK_URL` /
`WEBHOOK_SECRET` (signed `message.received` events).

### Connect an agent (MCP)

```sh
claude mcp add mailslot $WORKER/mcp \
  --transport http --header "Authorization: Bearer $TOKEN"
```

## The canonical demo

An agent signs itself up for a service, end to end:

```
agent: create_address()            → otp-x7f2@agents.example.com
agent: (signs up at the service using that address)
agent: wait_for_message(timeout=120)
agent: extract_otp()               → "482913"   [marked read-once]
agent: (submits the code — done)
```

No human inbox touched. No credentials shared. The address is disposable;
mint a new one per task.

## Why self-hosted

| | Hosted agent-email APIs | **Mailslot** |
|---|---|---|
| Who can read your mail | The provider | Nobody but you |
| Domain | Theirs (or delegated) | Yours |
| Mail storage | Their infrastructure | Your CF account (DO + R2) |
| Pricing model | Per-inbox tiers | Cloudflare's free tier goes far |
| Auditability | Trust the policy | Read the code |
| Works offline from vendor | No | There is no vendor |

Hosted APIs are a fine product. This is for the people and companies for whom
"a third party processes all my agent's mail" is a non-starter: self-hosters,
automation agencies deploying for clients, and anyone whose compliance team
asks where the data lives.

## Built on

- [Cloudflare Email Routing](https://developers.cloudflare.com/email-routing/) — the SMTP edge; no port 25, no mail server to run
- [Cloudflare Agents SDK](https://developers.cloudflare.com/agents/) — one Durable Object per inbox (`routeAgentEmail`, `onEmail`), `McpAgent` for the MCP surface
- [postal-mime](https://github.com/postalio/postal-mime) — MIME parsing built for Workers

Standard Cloudflare stack, thin on top. If you can maintain a Worker, you can
maintain this.

## Integrations

- **MCP** — works with any MCP client today (Claude Code, Claude Desktop, OpenClaw, custom agents)
- **n8n** — community node (trigger + actions) — *in progress*
- **OpenClaw skill** — points at *your* instance, not a hosted cloud — *in progress*

Adapters are thin wrappers over one versioned event schema and one tool API.
Want an adapter we don't have? The contract is small — PRs welcome.

## Roadmap

- [x] v1: receive → parse → store → MCP/HTTP tools → webhooks → forward
- [x] `create-mailslot` deploy wizard
- [x] Return-receipt auto-reply (`replyToEmail` — no ESP needed; set
      `RECEIPT_ADDRESSES` to enable per address, auto-mail loop guards built in)
- [ ] n8n community node, OpenClaw skill
- [ ] Outbound via your own Resend/Postmark/SES keys (BYO, your deliverability)

Deliberately **not** planned: hosted multi-tenant service, AI triage of your
personal mail, reading anything we don't have to. Boring, auditable plumbing.

## Need it deployed for you?

I do fixed-price integrations — your domain, your Cloudflare account, wired
into your n8n/agent stack, with a handover doc. *(Contact link coming with
the first release.)*

## License

MIT
