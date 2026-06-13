# create-mailslot

> A real inbox for AI agents. Self-hosted.

Deploy [Mailslot](https://github.com/mailslot/mailslot) to your own Cloudflare
account, interactively.

```sh
npx create-mailslot
```

The wizard:

1. **Scaffolds a project you own.** A thin worker depending on `@mailslot/core`,
   deployed from your machine with wrangler.
2. **Guards your existing mail.** If the domain's apex already receives mail
   elsewhere (Google Workspace, Lark, O365, and so on), the wizard tells you the
   truth: Email Routing is zone-level, so that domain cannot host Mailslot, not
   even on a subdomain, without breaking its mail. It steers you to a different
   domain instead of letting you find out the hard way.
3. **Provisions everything.** R2 bucket, a generated API token (secret), and a
   worker deploy with your domain baked in.
4. **Sets up Email Routing.** Fully automatic with a Cloudflare API token
   (`Zone → Email Routing Rules → Edit`), or guided dashboard steps with live
   DNS verification if you'd rather click.
5. **Proves it works.** Ends with a live round-trip: send an email from your
   phone, watch it appear in your terminal.

## Flags (all optional, omitted values are prompted)

```
--dir <path>           project directory            (default: mailslot)
--domain <domain>      email domain on Cloudflare   (e.g. mail.example.com)
--worker-name <name>   worker name                  (default: mailslot)
--cf-token <token>     Cloudflare API token for Email Routing setup
--core-spec <spec>     @mailslot/core version/spec  (default: matches this wizard's version)
--skip-install / --skip-routing / --skip-test
```

`CLOUDFLARE_API_TOKEN` in the environment is also honored.

Requirements: Node 18+, a Cloudflare account (free tier works), a domain on
Cloudflare.
