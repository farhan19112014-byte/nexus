/** Asset 93 — input/output validation helpers shared by memory, chat and diagnostics. */
const SENSITIVE: RegExp[] = [
  /\b(?:\d[ -]?){13,19}\b/,                    // card-like numbers
  /\b\d{3}-\d{2}-\d{4}\b/,                     // SSN-like
  /\b[A-Z]{5}\d{4}[A-Z]\b/,                    // PAN-like (India)
  /\b\d{4}\s?\d{4}\s?\d{4}\b/,                 // Aadhaar-like 12 digits
  /\b(password|passcode|pin code|otp|cvv|secret key|api[_ -]?key|private key)\b/i,
  /\b(sk|pk|rk)-[A-Za-z0-9_-]{12,}\b/,         // API-key-looking tokens
];
export const looksSensitive = (t: string) => SENSITIVE.some((r) => r.test(t));

/** Normalize user text: trim, strip control chars, cap length. */
export function sanitizeUserText(s: string, max = 4000) {
  // eslint-disable-next-line no-control-regex -- stripping control characters is the point
  return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);
}

/** Redact likely secrets before anything goes to diagnostics. */
export function redact(s: string) { let out = s; for (const r of SENSITIVE) out = out.replace(new RegExp(r.source, r.flags.includes('g') ? r.flags : r.flags + 'g'), '[redacted]'); return out; }
