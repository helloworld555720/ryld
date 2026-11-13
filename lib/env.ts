import "server-only";

import { z } from "zod";

/**
 * Validated lazily (on first use) rather than at module load, so `next build`
 * does not need runtime configuration. Container deployments inject env at
 * start time, not build time.
 */

const absoluteUrl = z
  .string()
  .trim()
  .min(1, "is required")
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch {
      return false;
    }
  }, "must be an absolute http(s) URL (e.g. https://api.example.com)")
  .transform((value) => value.replace(/\/+$/, ""));

export const serverEnvSchema = z.object({
  AUTH_SERVICE_URL: absoluteUrl,
  API_URL: absoluteUrl,
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function parseServerEnv(
  source: Record<string, string | undefined>,
): ServerEnv {
  const result = serverEnvSchema.safeParse(source);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");

    throw new Error(
      `Invalid server environment:\n${issues}\nCopy .env.example to .env.local and fill it in.`,
    );
  }

  return result.data;
}

let cached: ServerEnv | undefined;

export function getServerEnv(): ServerEnv {
  cached ??= parseServerEnv(process.env);
  return cached;
}
