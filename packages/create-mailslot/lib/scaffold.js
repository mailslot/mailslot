import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";

/** Render the files of a scaffolded Mailslot project.
 *  coreSpec is normally supplied by run.js (derived from the wizard's own
 *  version); the default here is only a fallback for direct calls/tests. */
export function templates({ workerName, coreSpec = "^0.2.0" }) {
  const pkg = {
    name: workerName,
    private: true,
    type: "module",
    scripts: {
      dev: "wrangler dev",
      deploy: "wrangler deploy",
      "cf-typegen": "wrangler types"
    },
    dependencies: {
      "@mailslot/core": coreSpec
    },
    devDependencies: {
      wrangler: "^4.0.0"
    }
  };

  const wranglerConfig = `{
  "$schema": "https://unpkg.com/wrangler/config-schema.json",
  "name": ${JSON.stringify(workerName)},
  "main": "src/index.ts",
  "compatibility_date": "2026-04-01",
  "compatibility_flags": ["nodejs_compat"],
  "durable_objects": {
    "bindings": [
      { "name": "Inbox", "class_name": "Inbox" },
      { "name": "MailslotMcp", "class_name": "MailslotMcp" }
    ]
  },
  "migrations": [
    { "tag": "v1", "new_sqlite_classes": ["Inbox", "MailslotMcp"] }
  ],
  "r2_buckets": [
    { "binding": "RAW", "bucket_name": ${JSON.stringify(`${workerName}-raw`)} }
  ],
  "vars": {
    "FORWARD_MODE": "none"
  },
  // Instance values (EMAIL_DOMAIN var, MAILSLOT_TOKEN secret) are set by the
  // wizard and survive deploys thanks to keep_vars.
  "keep_vars": true,
  "alias": {
    // Optional dep of the agents SDK, dynamically imported in unused paths
    "ai": "./src/shims/ai.ts"
  },
  "observability": { "enabled": true }
}
`;

  const indexTs = `export { Inbox, MailslotMcp } from "@mailslot/core";
export { default } from "@mailslot/core";
`;

  const aiShim = `/** Stub for the agents SDK's optional dynamic import("ai"). Unused by Mailslot. */
export function jsonSchema(): never {
  throw new Error("The 'ai' package is not installed — this code path is unused by Mailslot.");
}
`;

  const devVarsExample = `# Copy to .dev.vars for local development (never commit .dev.vars)
MAILSLOT_TOKEN=replace-me
EMAIL_DOMAIN=mail.example.com
`;

  const gitignore = `node_modules/
.wrangler/
.dev.vars
`;

  const readme = `# ${workerName}

A self-hosted [Mailslot](https://github.com/mailslot/mailslot) instance —
email inbox for AI agents on your own Cloudflare account.

Created with \`npx create-mailslot\`. Deploy updates with \`npm run deploy\`;
upgrade by bumping \`@mailslot/core\`.

Your API/MCP token is in \`.dev.vars\` (gitignored). MCP endpoint: \`/mcp\`.
`;

  return {
    "package.json": JSON.stringify(pkg, null, 2) + "\n",
    "wrangler.jsonc": wranglerConfig,
    "src/index.ts": indexTs,
    "src/shims/ai.ts": aiShim,
    ".dev.vars.example": devVarsExample,
    ".gitignore": gitignore,
    "README.md": readme
  };
}

/** Write scaffold files. Refuses to write into a non-empty directory. */
export async function writeScaffold(dir, files) {
  await mkdir(dir, { recursive: true });
  const existing = await readdir(dir);
  if (existing.length > 0) {
    throw new Error(`directory "${dir}" is not empty — pick a fresh directory`);
  }
  for (const [rel, content] of Object.entries(files)) {
    const path = join(dir, rel);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
  }
}
