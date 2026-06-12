import { spawn } from "node:child_process";

/** Run a command, capture output. Never rejects — inspect .code. */
export function sh(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env }
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    if (opts.input !== undefined) child.stdin.write(opts.input);
    child.stdin.end();
    child.on("error", (e) => resolve({ code: -1, out, err: String(e), all: out + err }));
    child.on("close", (code) => resolve({ code, out, err, all: out + err }));
  });
}

/** Run a command with inherited stdio (interactive). Resolves with exit code. */
export function shInteractive(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: "inherit", cwd: opts.cwd });
    child.on("error", () => resolve(-1));
    child.on("close", (code) => resolve(code));
  });
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
