# Mailslot

Self-hosted email inbox for AI agents on the user's own Cloudflare account.
npm workspace monorepo: `packages/core` (the published library worker),
`packages/create-mailslot` (deploy wizard — currently a placeholder bin),
`packages/instance` (private, unpublished — this account's live mailslot.dev
worker: `@mailslot/core` + a custom return-receipt auto-reply).

## Commands

```sh
npm install                 # workspace root
npm run typecheck           # all packages
npm run test                # vitest (pure-function tests in packages/core/test)
npm run deploy              # wrangler deploy of @mailslot/instance (the live worker)
cd packages/core && npx wrangler dev --local   # local dev (needs .dev.vars)
```

## Architecture (packages/core/src)

- `index.ts` — worker entry: `fetch` (auth → /mcp → /v1 API), `email`
  (routeAgentEmail with a catch-all resolver: every address on EMAIL_DOMAIN
  routes to its own `Inbox` DO, instance name = lowercased full address)
- `inbox.ts` — `Inbox extends Agent` (Cloudflare Agents SDK). One Durable
  Object per address: `onEmail` parses (postal-mime) → DO SQL + raw MIME to
  R2 → optional forward → `onStored` hook → webhook. `onStored(email, msg)` is
  a protected no-op extension point (runs while the email proxy is valid,
  before webhook); core ships no outbound/business logic — subclasses override
  it (see `packages/instance`). RPC methods: list/get/extractOtp (READ-ONCE
  per message)/extractLinks/waitForMessage (long-poll)/info
- `mcp.ts` — `MailslotMcp extends McpAgent`: six tools, thin wrappers over
  Inbox RPC
- `api.ts` — HTTP mirror of the same tools; `auth.ts` — constant-time bearer
  check + address minting; `extract.ts` — pure OTP/link extraction (tested)
- `shims/ai.ts` — stub for the agents SDK's optional dynamic `import("ai")`,
  aliased in wrangler.jsonc

`packages/instance/src/index.ts` subclasses `Inbox`, overrides `onStored` to
send a return receipt via Email Routing (`replyToEmail`, no ESP) for addresses
in `RECEIPT_ADDRESSES`, guarded by a `shouldAutoReply` loop check. Its
`wrangler.jsonc` mirrors the live worker's identity (name `mailslot`, same DO
classes + migration tag `v1` + bucket) so deploys adopt the existing data.

## Conventions & constraints

- **Thin waist:** adapters (MCP, n8n, OpenClaw) wrap one versioned event
  schema (`message.received`, `v:1`) and one tool API. Adapters contain zero
  business logic. Max 3 maintained adapters; a 4th requires a paying user.
- **Instance config is never committed:** `EMAIL_DOMAIN` (dashboard var,
  survives deploys via `keep_vars`), `MAILSLOT_TOKEN` (secret). Repo's
  wrangler.jsonc stays generic. Never write `.dev.vars`.
- `@modelcontextprotocol/sdk` is pinned to the exact version the `agents`
  package bundles (type identity breaks otherwise). Check before bumping.
- npm publish requires 2FA (or granular token w/ bypass for CI).
  Scoped packages publish with `publishConfig.access: public`.
- Keep scope deliberately small: no AI triage, no hosted multi-tenant, no
  outbound ESP in core. See README "Deliberately not planned".
