import { describe, it, expect } from "vitest";
import type { AgentEmail } from "@mailslot/core";
import { shouldAutoReply } from "../src/auto-reply";

/** Minimal AgentEmail stand-in: shouldAutoReply only reads `from` + `headers`. */
function email(from: string, headers: Record<string, string> = {}): AgentEmail {
  return { from, headers: new Headers(headers) } as unknown as AgentEmail;
}

describe("shouldAutoReply", () => {
  it("replies to a normal human sender", () => {
    expect(shouldAutoReply(email("alice@example.com"))).toBe(true);
  });

  it("ignores empty senders", () => {
    expect(shouldAutoReply(email(""))).toBe(false);
  });

  it("never answers mailer-daemon or postmaster", () => {
    expect(shouldAutoReply(email("mailer-daemon@example.com"))).toBe(false);
    expect(shouldAutoReply(email("postmaster@example.com"))).toBe(false);
  });

  it("suppresses Auto-Submitted mail but allows 'no'", () => {
    expect(shouldAutoReply(email("x@y.com", { "auto-submitted": "auto-replied" }))).toBe(false);
    expect(shouldAutoReply(email("x@y.com", { "auto-submitted": "no" }))).toBe(true);
  });

  it("respects X-Auto-Response-Suppress", () => {
    expect(shouldAutoReply(email("x@y.com", { "x-auto-response-suppress": "All" }))).toBe(false);
  });

  it("never answers list mail", () => {
    expect(shouldAutoReply(email("x@y.com", { "list-id": "<l.example.com>" }))).toBe(false);
    expect(shouldAutoReply(email("x@y.com", { "list-unsubscribe": "<mailto:u@x.com>" }))).toBe(false);
  });

  it("skips bulk/junk/list precedence, replies otherwise", () => {
    for (const p of ["bulk", "junk", "list"]) {
      expect(shouldAutoReply(email("x@y.com", { precedence: p }))).toBe(false);
    }
    expect(shouldAutoReply(email("x@y.com", { precedence: "first-class" }))).toBe(true);
  });
});
