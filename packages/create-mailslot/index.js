#!/usr/bin/env node
import { run } from "./lib/run.js";

run(process.argv.slice(2)).catch((e) => {
  console.error(`\ncreate-mailslot failed: ${e.message}`);
  process.exit(1);
});
