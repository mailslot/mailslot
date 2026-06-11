/**
 * Pure extraction helpers. No I/O — unit-tested directly.
 */

const OTP_KEYWORDS =
  /\b(otp|one[- ]?time|verification|verify|confirm(?:ation)?|security|login|sign[- ]?in|access|auth(?:entication)?|pass)\b|code|코드|認証|驗證|验证|kod/i;

/** Strip HTML to text, crudely but safely (no DOM on Workers). */
export function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ")
    .trim();
}

type OtpCandidate = { code: string; score: number };

/**
 * Find the most likely OTP in a message.
 * Heuristics: 4-8 digit (or dash/space-grouped) runs, scored by proximity to
 * OTP-ish keywords and penalized when they look like dates, phones, or prices.
 */
export function extractOtp(subject: string, body: string): string | null {
  const haystacks = [
    { text: subject ?? "", bonus: 2 },
    { text: body ?? "", bonus: 0 }
  ];
  const candidates: OtpCandidate[] = [];

  for (const { text, bonus } of haystacks) {
    // 123456 | 123-456 | 123 456 | A1B2C3-style codes
    // Trailing sentence punctuation is fine; reject only digit/decimal continuations.
    const re = /(?<![\d.,-])(\d{4,8}|\d{3}[- ]\d{3}|[A-Z0-9]{6,8})(?!\d|[.,]\d)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const raw = m[1];
      const code = raw.replace(/[- ]/g, "");
      // Alphanumeric candidates must mix letters and digits (else it's a word)
      if (/[A-Z]/.test(code) && !/\d/.test(code)) continue;
      // All-digit length sanity
      if (/^\d+$/.test(code) && (code.length < 4 || code.length > 8)) continue;

      let score = bonus;
      const ctx = text.slice(Math.max(0, m.index - 60), m.index + raw.length + 60);
      if (OTP_KEYWORDS.test(ctx)) score += 4;
      // Penalties: looks like a year, a date fragment, a price, or a phone
      if (/^(19|20)\d{2}$/.test(code)) score -= 3;
      if (/[$€£¥]\s*$/.test(text.slice(Math.max(0, m.index - 4), m.index))) score -= 3;
      if (/\d[\d\s().-]{8,}/.test(text.slice(Math.max(0, m.index - 12), m.index + raw.length + 4))) score -= 2;
      // 6 digits is the archetypal OTP
      if (/^\d{6}$/.test(code)) score += 2;

      candidates.push({ code, score });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  return best && best.score >= 2 ? best.code : null;
}

/** Extract unique http(s) links, hrefs first (HTML), then bare URLs (text). */
export function extractLinks(text: string, html: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (u: string) => {
    const cleaned = u.replace(/[)\].,;'"!>]+$/, "");
    if (!seen.has(cleaned)) {
      seen.add(cleaned);
      out.push(cleaned);
    }
  };

  if (html) {
    const hrefRe = /href\s*=\s*["']?(https?:\/\/[^"'\s>]+)/gi;
    let m: RegExpExecArray | null;
    while ((m = hrefRe.exec(html)) !== null) push(m[1]);
  }
  if (text) {
    const urlRe = /https?:\/\/[^\s<>"']+/gi;
    let m: RegExpExecArray | null;
    while ((m = urlRe.exec(text)) !== null) push(m[0]);
  }
  return out;
}

/** First ~140 chars of body text for list views and webhook payloads. */
export function makeSnippet(text: string, html: string): string {
  const source = (text && text.trim()) || htmlToText(html || "");
  return source.replace(/\s+/g, " ").trim().slice(0, 140);
}
