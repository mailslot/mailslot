import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArgs } from "../lib/run.js";
import { templates } from "../lib/scaffold.js";
import { isCloudflareMx, isCloudflareNs, findZone } from "../lib/dns.js";

test("parseArgs handles values and booleans", () => {
  const flags = parseArgs(["--dir", "out", "--skip-test", "--domain", "mail.x.com"]);
  assert.equal(flags.dir, "out");
  assert.equal(flags["skip-test"], true);
  assert.equal(flags.domain, "mail.x.com");
});

test("templates render valid JSON and reference the worker name", () => {
  const files = templates({ workerName: "my-inbox", coreSpec: "^0.0.2" });
  const pkg = JSON.parse(files["package.json"]);
  assert.equal(pkg.name, "my-inbox");
  assert.equal(pkg.dependencies["@mailslot/core"], "^0.0.2");

  assert.match(files["wrangler.jsonc"], /"name": "my-inbox"/);
  assert.match(files["wrangler.jsonc"], /"bucket_name": "my-inbox-raw"/);
  assert.match(files["wrangler.jsonc"], /"keep_vars": true/);
  assert.match(files["src/index.ts"], /@mailslot\/core/);
  assert.ok(files["src/shims/ai.ts"]);
  assert.ok(files[".gitignore"].includes(".dev.vars"));
});

test("isCloudflareMx / isCloudflareNs detect Cloudflare records", () => {
  assert.equal(isCloudflareMx(["34 route1.mx.cloudflare.net."]), true);
  assert.equal(isCloudflareMx(["1 mx1.larksuite.com."]), false);
  assert.equal(isCloudflareNs(["dana.ns.cloudflare.com."]), true);
  assert.equal(isCloudflareNs(["ns1.google.com."]), false);
});

test("findZone walks labels until NS records answer", async () => {
  const fakeResolve = async (name, type) => {
    assert.equal(type, "NS");
    return name === "example.com" ? ["dana.ns.cloudflare.com."] : [];
  };
  const zone = await findZone("mail.deep.example.com", fakeResolve);
  assert.equal(zone.zone, "example.com");

  const none = await findZone("nope.invalid", async () => []);
  assert.equal(none, null);
});
