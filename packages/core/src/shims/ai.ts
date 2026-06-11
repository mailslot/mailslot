/**
 * Stub for the optional "ai" (Vercel AI SDK) dependency that the agents SDK
 * imports dynamically in code paths Mailslot never uses. Aliased in
 * wrangler.jsonc so the bundler can resolve it without shipping the SDK.
 */
export function jsonSchema(): never {
  throw new Error("The 'ai' package is not installed — this code path is unused by Mailslot.");
}
