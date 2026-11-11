const SECRET_PATTERNS = [
  /bearer\s+[a-z0-9._\-+/=]+/gi,
  /\b(sk|rk|pk|api|tok)_[a-z0-9]{8,}\b/gi,
  /\b(password|passwd|secret|token|api[_-]?key)\b\s*[:=]\s*\S+/gi,
];

export function redactText(value: string, max = 4000): string {
  let next = value;
  for (const pattern of SECRET_PATTERNS) {
    next = next.replace(pattern, "[redacted]");
  }
  if (next.length > max) return `${next.slice(0, max)}…`;
  return next;
}

export function maskValue(value: string, sensitive: boolean): string {
  if (!sensitive) return value;
  if (value.length <= 2) return "••";
  return `${value.slice(0, 1)}${"•".repeat(Math.min(8, value.length - 2))}${value.slice(-1)}`;
}

export function redactRecord(record: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (/(password|secret|token|authorization|cookie)/i.test(key)) {
      out[key] = "[redacted]";
    } else if (typeof value === "string") {
      out[key] = redactText(value, 500);
    } else {
      out[key] = value;
    }
  }
  return out;
}
