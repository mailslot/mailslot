# create-mailslot

Deploy [Mailslot](https://github.com/mailslot/mailslot) — a self-hosted email
inbox for AI agents — to your own Cloudflare account, interactively.

> Your agent's email shouldn't come with a landlord.

```sh
npx create-mailslot
```

The wizard:

1. **Scaffolds a project you own** — a thin worker depending on
   `@mailslot/core`, deployed from your machine with wrangler
2. **Guards your existing mail** — if your apex domain already has MX records
   (Google Workspace, Lark, O365…), it routes Mailslot through a subdomain
   and never touches apex mail records
3. **Provisions everything** — R2 bucket, generated API token (secret),
   worker deploy with your domain baked in
4. **Sets up Email Routing** — fully automatic with a Cloudflare API token
   (`Zone → Email Routing Rules → Edit`), or guided dashboard steps with
   live DNS verification if you'd rather click
5. **Proves it works** — ends with a live round-trip: send an email from
   your phone, watch it appear in your terminal

## Flags (all optional — omitted values are prompted)

```
--dir <path>           project directory            (default: mailslot)
--domain <domain>      email domain on Cloudflare   (e.g. mail.example.com)
--worker-name <name>   worker name                  (default: mailslot)
--cf-token <token>     Cloudflare API token for Email Routing setup
--core-spec <spec>     @mailslot/core version/spec  (default: ^0.0.2)
--skip-install / --skip-routing / --skip-test
```

`CLOUDFLARE_API_TOKEN` in the environment is also honored.

Requirements: Node 18+, a Cloudflare account (free tier works), a domain on
Cloudflare.
