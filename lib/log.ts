type Level = "debug" | "info" | "warn" | "error";

const REDACTED = "[redacted]";
const SENSITIVE_KEY =
  /(cookie|authorization|set-cookie|token|password|secret|api[-_]?key|session)/i;

/**
 * Recursively replaces values of sensitive keys. Depth-limited so a cyclic or
 * pathologically nested object can never stall a request.
 */
function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[depth-limit]";
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (value instanceof Error) {
    return { name: value.name, message: value.message };
  }

  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    output[key] = SENSITIVE_KEY.test(key) ? REDACTED : redact(entry, depth + 1);
  }
  return output;
}

/**
 * Structured, redacted logging. Server-only: does nothing in the browser so a
 * stray import can never leak request data to the console of a client bundle.
 */
export function log(
  level: Level,
  event: string,
  fields: Record<string, unknown> = {},
): void {
  if (typeof window !== "undefined") return;

  const line = JSON.stringify({
    level,
    event,
    time: new Date().toISOString(),
    ...(redact(fields) as Record<string, unknown>),
  });

  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export function newRequestId(): string {
  return crypto.randomUUID();
}
