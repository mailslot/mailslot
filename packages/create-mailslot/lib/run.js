import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import * as p from "@clack/prompts";
import { sh, shInteractive, sleep } from "./sh.js";
import { mxRecords, isCloudflareMx, isCloudflareNs, findZone, waitForCloudflareMx, zoneRoutingState } from "./dns.js";
import { templates, writeScaffold } from "./scaffold.js";
import { zoneId, routingStatus, enableRouting, setCatchAllToWorker } from "./cf-api.js";

// Wizard and core ship in lockstep (same repo version), so the inbox we
// scaffold should depend on the core that matches THIS wizard's version.
const selfVersion = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

export function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      flags[key] = next;
      i++;
    } else {
      flags[key] = true;
    }
  }
  return flags;
}

function bail(value) {
  if (p.isCancel(value)) {
    p.cancel("Setup cancelled — nothing was deployed.");
    process.exit(0);
  }
  return value;
}

export async function run(argv) {
  const flags = parseArgs(argv);

  p.intro("create-mailslot — your agent's inbox, on your own Cloudflare account");

  // ---- gather inputs ----
  const dir = resolve(
    flags.dir ??
      bail(await p.text({ message: "Project directory", initialValue: "mailslot", validate: (v) => (v.trim() ? undefined : "required") }))
  );

  let domain = String(
    flags.domain ??
      bail(
        await p.text({
          message: "Email domain for agent addresses (on Cloudflare)",
          placeholder: "mail.example.com",
          validate: (v) => (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(v.trim()) ? undefined : "enter a domain like mail.example.com")
        })
      )
  )
    .trim()
    .toLowerCase();

  const workerName = String(
    flags["worker-name"] ??
      bail(await p.text({ message: "Worker name", initialValue: "mailslot", validate: (v) => (/^[a-z0-9-]+$/.test(v) ? undefined : "lowercase letters, digits, dashes") }))
  );

  // ---- DNS analysis & the zone-routing reality check ----
  // Email Routing is zone-level: a subdomain only works once the ZONE has
  // Email Routing enabled, and enabling it requires Cloudflare to own the
  // apex MX. A zone whose apex mail lives elsewhere cannot host Mailslot
  // at all (not even via a subdomain) without breaking that mail.
  const s = p.spinner();
  let apex;
  let zoneState; // "cloudflare" | "none" | "foreign" (foreign only if user forces)
  for (;;) {
    s.start("Checking DNS");
    const zone = await findZone(domain).catch(() => null);
    if (!zone) {
      s.stop("DNS check failed");
      throw new Error(`could not find a DNS zone for ${domain} — is the domain registered and on Cloudflare?`);
    }
    apex = zone.zone;
    const onCloudflare = isCloudflareNs(zone.ns);
    const apexMx = await mxRecords(apex).catch(() => []);
    zoneState = zoneRoutingState(apexMx);
    s.stop(`Zone: ${apex}${onCloudflare ? " (Cloudflare ✓)" : ""} — email routing: ${zoneState}`);

    if (!onCloudflare) {
      p.log.warn(`${apex} does not appear to use Cloudflare nameservers.\nMailslot requires the zone to be on Cloudflare (free plan is fine).`);
      const cont = bail(await p.confirm({ message: "Continue anyway?", initialValue: false }));
      if (!cont) return p.outro("Add the domain to Cloudflare first, then re-run.");
    }

    if (zoneState !== "foreign") break;

    p.log.error(
      `${apex} already receives mail elsewhere (MX: ${apexMx[0]} …).\n\n` +
        `Cloudflare Email Routing is zone-level: enabling it requires replacing\n` +
        `the apex MX records, and subdomains can only be added AFTER the zone\n` +
        `has Email Routing enabled. This domain cannot host Mailslot — not even\n` +
        `on a subdomain — without breaking its existing email.`
    );
    if (flags.domain) {
      throw new Error(`${apex} has a third-party mail provider — use a different domain (zone) for Mailslot`);
    }
    const choice = bail(
      await p.select({
        message: "What now?",
        options: [
          { value: "different", label: "Use a different domain (recommended — a spare domain or a fresh one)" },
          { value: "force", label: `Proceed with ${apex} anyway (I will delete my provider's MX — BREAKS existing mail)` },
          { value: "abort", label: "Abort" }
        ]
      })
    );
    if (choice === "abort") return p.outro("No changes made. A dedicated domain for agent mail is cheap and clean.");
    if (choice === "force") {
      const sure = bail(await p.confirm({ message: `Really proceed? Mail to @${apex} will stop working until you reconfigure it.`, initialValue: false }));
      if (sure) break;
      continue;
    }
    domain = String(
      bail(
        await p.text({
          message: "Email domain for agent addresses (on Cloudflare)",
          placeholder: "agentmail-domain.com",
          validate: (v) => (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(v.trim()) ? undefined : "enter a valid domain")
        })
      )
    )
      .trim()
      .toLowerCase();
  }

  const domainMx = await mxRecords(domain).catch(() => []);
  const routingReady = isCloudflareMx(domainMx);

  // ---- scaffold ----
  const coreSpec = flags["core-spec"] ?? `^${selfVersion}`;
  const files = templates({ workerName, coreSpec });
  await writeScaffold(dir, files);
  p.log.success(`Scaffolded ${dir}`);

  if (!flags["skip-install"]) {
    p.log.step("Installing dependencies…");
    const code = await shInteractive("npm", ["install", "--no-fund", "--no-audit"], { cwd: dir });
    if (code !== 0) throw new Error("npm install failed");
  }

  const wrangler = (args, opts = {}) => sh("npx", ["wrangler", ...args], { cwd: dir, ...opts });

  // ---- wrangler auth ----
  const who = await wrangler(["whoami"]);
  if (!/You are logged in/i.test(who.all)) {
    p.log.step("Logging in to Cloudflare (browser will open)…");
    const code = await shInteractive("npx", ["wrangler", "login"], { cwd: dir });
    if (code !== 0) throw new Error("wrangler login failed");
  }

  // ---- existing-instance guard ----
  // Re-running against a live worker rotates MAILSLOT_TOKEN (existing
  // API/MCP clients break until updated) and replaces the deployed code.
  // Inbox data survives: same worker name + DO classes + R2 bucket.
  const existing = await wrangler(["deployments", "list"]);
  if (existing.code === 0) {
    p.log.warn(
      `A worker named "${workerName}" is already deployed on this account.\n` +
        `Continuing will:\n` +
        `  • rotate MAILSLOT_TOKEN — existing API/MCP clients stop working\n` +
        `    until you give them the new token\n` +
        `  • replace the deployed code with @mailslot/core ${coreSpec}\n` +
        `Inbox data (messages, raw mail) is preserved.`
    );
    const overwrite = bail(await p.confirm({ message: "Continue and overwrite?", initialValue: false }));
    if (!overwrite) return p.outro("No changes deployed — your existing instance is untouched.");
  }

  // ---- provision: bucket, token, deploy ----
  s.start("Creating R2 bucket");
  const bucket = await wrangler(["r2", "bucket", "create", `${workerName}-raw`]);
  if (bucket.code !== 0 && !/already exists/i.test(bucket.all)) {
    s.stop("R2 bucket failed");
    throw new Error(`could not create R2 bucket: ${bucket.err.slice(0, 300)}`);
  }
  s.stop("R2 bucket ready");

  const token = randomBytes(24).toString("hex");
  s.start("Setting MAILSLOT_TOKEN secret");
  const secret = await wrangler(["secret", "put", "MAILSLOT_TOKEN"], { input: token + "\n" });
  if (secret.code !== 0) {
    s.stop("Secret failed");
    throw new Error(`could not set secret: ${secret.err.slice(0, 300)}`);
  }
  s.stop("Token secret set");

  s.start("Deploying worker");
  const deploy = await wrangler(["deploy", "--var", `EMAIL_DOMAIN:${domain}`]);
  if (deploy.code !== 0) {
    s.stop("Deploy failed");
    throw new Error(`wrangler deploy failed:\n${deploy.all.slice(-600)}`);
  }
  const workerUrl = deploy.all.match(/https:\/\/[a-z0-9.-]+\.workers\.dev/i)?.[0] ?? null;
  s.stop(`Deployed${workerUrl ? `: ${workerUrl}` : ""}`);

  await writeFile(join(dir, ".dev.vars"), `MAILSLOT_TOKEN=${token}\nEMAIL_DOMAIN=${domain}\n`);

  if (workerUrl) {
    const health = await fetch(`${workerUrl}/v1/health`).then((r) => r.ok).catch(() => false);
    if (health) p.log.success("Health check passed");
  }

  // ---- email routing ----
  if (!flags["skip-routing"]) {
    await setupRouting({ apex, domain, workerName, routingReady, zoneState, flags });
  }

  // ---- round-trip finale ----
  if (!flags["skip-test"] && workerUrl) {
    await roundTrip({ workerUrl, token, domain });
  }

  p.note(
    [
      `Worker      ${workerUrl ?? "(see wrangler output)"}`,
      `Domain      ${domain}`,
      `API token   ${dir}/.dev.vars (keep it safe)`,
      ``,
      `Connect an agent (MCP):`,
      `  claude mcp add mailslot ${workerUrl ?? "<worker-url>"}/mcp \\`,
      `    --transport http --header "Authorization: Bearer <token>"`,
      ``,
      `Mint an address:`,
      `  curl -X POST ${workerUrl ?? "<worker-url>"}/v1/addresses \\`,
      `    -H "Authorization: Bearer <token>"`
    ].join("\n"),
    "Your agent has email now"
  );
  p.outro("Docs & issues: https://github.com/mailslot/mailslot");
}

async function setupRouting({ apex, domain, workerName, routingReady, zoneState, flags }) {
  const isSubdomain = domain !== apex;
  let token = flags["cf-token"] ?? process.env.CLOUDFLARE_API_TOKEN ?? null;
  if (!token) {
    const entered = bail(
      await p.password({
        message:
          "Cloudflare API token for Email Routing setup (Enter to skip and use guided steps).\n" +
          "  Create one at dash.cloudflare.com → My Profile → API Tokens with:\n" +
          "  Zone → Email Routing Rules → Edit, Zone → Zone → Read (this zone)",
        mask: "•"
      })
    );
    token = entered && String(entered).trim() ? String(entered).trim() : null;
  }

  if (token) {
    try {
      const zid = await zoneId(token, apex);
      if (!zid) throw new Error(`zone ${apex} not visible to this token`);

      // Zone-level enable comes first — subdomains can only be enrolled
      // once the zone has Email Routing.
      if (zoneState !== "cloudflare") {
        const status = await routingStatus(token, zid).catch(() => null);
        if (status?.enabled !== true) await enableRouting(token, zid);
        await waitForCloudflareMx(apex, { timeoutMs: 120_000 });
        p.log.success(`Email Routing enabled on ${apex}`);
      }

      if (!routingReady && isSubdomain) {
        // No public API for subdomain enrollment — guided step, then verify.
        await guidedSubdomain(apex, domain);
      }

      await setCatchAllToWorker(token, zid, workerName);
      p.log.success(`Catch-all rule → worker "${workerName}"`);
      return;
    } catch (e) {
      p.log.warn(`API setup incomplete (${e.message}) — falling back to guided steps.`);
    }
  }

  // Guided path
  if (!routingReady) {
    if (zoneState !== "cloudflare") {
      p.note(
        [
          `1. dash.cloudflare.com → ${apex} → Email Routing`,
          ...(zoneState === "foreign"
            ? [`2. Delete the existing third-party MX records when prompted`, `   (this is the step that breaks your old mail — you chose this)`, `3. Enable Email Routing (accept the MX/SPF records)`]
            : [`2. Enable Email Routing (accept the MX/SPF records)`])
        ].join("\n"),
        `Enable Email Routing on ${apex}`
      );
      await waitForMxInteractive(apex);
    }
    if (isSubdomain) await guidedSubdomain(apex, domain);
  }
  p.note(
    [
      `1. ${apex} → Email Routing → Routing rules`,
      `2. Catch-all address → Edit`,
      `3. Action: "Send to a Worker" → ${workerName}`,
      `4. Toggle: Enabled  ← easy to miss`
    ].join("\n"),
    "Point mail at the worker"
  );
  bail(await p.confirm({ message: "Catch-all rule set and enabled?", initialValue: true }));
}

async function guidedSubdomain(apex, domain) {
  const sub = domain.slice(0, -(apex.length + 1));
  p.note(
    [
      `(requires Email Routing already enabled on ${apex})`,
      `1. dash.cloudflare.com → ${apex} → Email Routing → Settings`,
      `2. Subdomains → add "${sub}"`,
      `3. Cloudflare writes MX/SPF records on ${domain}`
    ].join("\n"),
    "Add the subdomain to Email Routing"
  );
  await waitForMxInteractive(domain);
}

async function waitForMxInteractive(domain) {
  const s = p.spinner();
  s.start(`Waiting for Cloudflare MX records on ${domain}`);
  const ok = await waitForCloudflareMx(domain, { timeoutMs: 300_000 });
  if (ok) s.stop(`MX records live on ${domain}`);
  else {
    s.stop("Timed out waiting for MX records");
    throw new Error(`MX records for ${domain} did not appear — complete the dashboard step and re-run`);
  }
}

async function roundTrip({ workerUrl, token, domain }) {
  const local = `welcome-${randomBytes(3).toString("hex")}`;
  const address = `${local}@${domain}`;
  p.log.step(`Round-trip test — send any email to:  ${address}`);
  const s = p.spinner();
  s.start("Waiting for your email (up to 5 minutes, Ctrl+C to skip)");
  const deadline = Date.now() + 300_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(
        `${workerUrl}/v1/inboxes/${encodeURIComponent(address)}/wait?timeout_s=50&since_s=600`,
        { headers: { authorization: `Bearer ${token}` } }
      );
      const data = await res.json();
      if (data.message) {
        s.stop(`Received: "${data.message.subject}" from ${data.message.from} ✓`);
        return;
      }
    } catch {
      await sleep(3000);
    }
  }
  s.stop("No email arrived — check the catch-all rule, then test manually (see README).");
}
