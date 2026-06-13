# @mailslot/core

The Mailslot worker as a library: a self-hosted email inbox for AI agents on
your own Cloudflare account. One Durable Object per address, MCP plus HTTP plus
webhook surfaces, read-once OTP extraction.

Deploy it with the wizard, `npx create-mailslot`, which scaffolds a thin project
importing this package and walks the whole setup. Or deploy from source with
wrangler: see the [setup guide](https://github.com/mailslot/mailslot#quick-start).

To customize a deployment, subclass `Inbox` and override the protected
`onStored(email, message)` hook. It runs after the message is stored, while the
email proxy is still valid, so it is the place for per-deployment logic like
auto-replies or custom notifications, without forking core.
