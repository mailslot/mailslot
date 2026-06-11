import { describe, expect, it } from "vitest";
import { extractLinks, extractOtp, htmlToText, makeSnippet } from "../src/extract";

describe("extractOtp", () => {
  it("finds a 6-digit code near a keyword", () => {
    expect(extractOtp("Your verification code", "Your code is 482913. It expires in 10 minutes.")).toBe("482913");
  });

  it("finds the code in the subject line", () => {
    expect(extractOtp("123456 is your Acme login code", "Open the app and enter the code.")).toBe("123456");
  });

  it("handles dash-grouped codes", () => {
    expect(extractOtp("Security code", "Enter 832-901 to continue")).toBe("832901");
  });

  it("handles 4-digit and 8-digit codes", () => {
    expect(extractOtp("Your OTP", "PIN code: 4821")).toBe("4821");
    expect(extractOtp("Confirm your account", "Confirmation code 48291036")).toBe("48291036");
  });

  it("prefers the code over a year in the same message", () => {
    expect(extractOtp("Verify your email", "© 2026 Acme Inc. Your verification code is 771204.")).toBe("771204");
  });

  it("ignores prices", () => {
    expect(extractOtp("Receipt", "You paid $4821 for your order. Thanks!")).toBeNull();
  });

  it("returns null when nothing code-like exists", () => {
    expect(extractOtp("Welcome!", "Thanks for joining. Have a great day.")).toBeNull();
  });

  it("finds alphanumeric codes near keywords", () => {
    expect(extractOtp("Your access code", "Use code X7K2F9 to sign in")).toBe("X7K2F9");
  });
});

describe("extractLinks", () => {
  it("extracts hrefs from HTML before bare text URLs", () => {
    const html = '<a href="https://example.com/verify?t=abc">Verify</a>';
    const text = "Or copy this: https://example.com/help";
    expect(extractLinks(text, html)).toEqual([
      "https://example.com/verify?t=abc",
      "https://example.com/help"
    ]);
  });

  it("dedupes and strips trailing punctuation", () => {
    const text = "Go to https://example.com/a. Again: https://example.com/a";
    expect(extractLinks(text, "")).toEqual(["https://example.com/a"]);
  });

  it("ignores non-http schemes", () => {
    expect(extractLinks("mailto:a@b.com and ftp://x.com", "")).toEqual([]);
  });
});

describe("htmlToText / makeSnippet", () => {
  it("strips tags, styles, and entities", () => {
    const html = "<style>p{color:red}</style><p>Hello&nbsp;&amp;&nbsp;welcome</p>";
    expect(htmlToText(html)).toBe("Hello & welcome");
  });

  it("prefers text body and truncates at 140 chars", () => {
    const long = "x".repeat(200);
    expect(makeSnippet(long, "")).toHaveLength(140);
    expect(makeSnippet("", "<p>from html</p>")).toBe("from html");
  });
});
