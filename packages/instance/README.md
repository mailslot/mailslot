# @mailslot/instance

The live **mailslot.dev** worker. Private and **never published** — it exists
only in this repo.

It's structurally identical to what `npx create-mailslot` generates for anyone
else: install [`@mailslot/core`](../core) and re-export its worker. The one
difference is a single customization — a return-receipt auto-reply that proves
the worker handled inbound mail — added by subclassing `Inbox` and overriding
the core `onStored(email, message)` hook. The reply logic and all mailslot.dev
branding live here and never reach the published library.

If you're looking for the canonical example of **how to customize a Mailslot
deployment**, `src/index.ts` is it.

## Layout

- `src/index.ts` — the `Inbox` subclass + worker entry (re-exports core's
  handler and `MailslotMcp`).
- `src/auto-reply.ts` — pure receipt helpers (`shouldAutoReply`, `receiptBody`);
  unit-tested in `test/`.
- `wrangler.jsonc` — mirrors the live worker's identity (name `mailslot`, DO
  classes, migration tag `v1`, bucket) so a deploy **updates the existing
  worker and adopts its stored mail** rather than creating a new one.

## Commands

```sh
npm run deploy --workspace @mailslot/instance   # or `npm run deploy` from root
npm test --workspace @mailslot/instance
```

Instance config is never committed. Set once (survives deploys via `keep_vars`):
`EMAIL_DOMAIN` (var), `MAILSLOT_TOKEN` (secret), and `RECEIPT_ADDRESSES` (var)
for the addresses that should send a return receipt. Note: an auto-reply
answers a forgeable `From`, so prefer a dedicated demo address over a public
contact address.
