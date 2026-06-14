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

## Outbound: replying via the Agents SDK (no ESP)

Mailslot's core ships no outbound logic, but you don't need a Resend/Postmark/SES
key to send a reply. The Cloudflare Agents SDK gives every `Inbox` a
`replyToEmail(email, options)` method that answers the sender back over Email
Routing — it builds a MIME message (correct `In-Reply-To`/`Message-ID` threading
headers) and calls `email.reply()` on the inbound message.

The catch: `email.reply()` is only valid while the inbound email proxy is live,
i.e. inside the `onStored(email, message)` hook, before the webhook fires. So the
pattern is "reply during processing," not "send arbitrary mail later."

```ts
export class Inbox extends CoreInbox {
  protected async onStored(email: AgentEmail, msg: MessageSummary): Promise<void> {
    if (!this.isReceiptAddress() || !shouldAutoReply(email)) return;
    await this.replyToEmail(email, {
      fromName: "Mailslot",
      body: receiptBody(this.address, msg)
      // subject defaults to `Re: <original>`; pass `subject`/`contentType`/`headers` to override
    });
  }
}
```

See `src/index.ts` for the full version, including the `shouldAutoReply` loop
guard that suppresses replies to auto-generated, bulk, and bounce mail.

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
