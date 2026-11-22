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

/**
 * Optional. The bucket or CDN root in front of a project's output: the API
 * reports artefact keys rather than URLs (`79b7…/master.m3u8`), and this is what
 * they are joined onto. `MEDIA_SEGMENT_BASE_URL` is the same shape and serves a
 * second host, so playback still works when manifests and segments live on
 * different origins. Parsed twice on purpose — `superRefine` rejects a
 * malformed value, the transform normalises an unset one to `undefined` so the
 * video page can say "not configured" instead of guessing a host.
 */
const optionalAbsoluteUrl = z
  .string()
  .trim()
  .optional()
  .superRefine((value, ctx) => {
    if (value === undefined || value === "") return;

    try {
      const url = new URL(value);
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        ctx.addIssue({
          code: "custom",
          message: "must be an absolute http(s) URL",
        });
      }
    } catch {
      ctx.addIssue({
        code: "custom",
        message: "must be an absolute http(s) URL (e.g. https://media.example.com)",
      });
    }
  })
  .transform((value) => {
    const text = (value ?? "").replace(/\/+$/, "");
    return text === "" ? undefined : text;
  });

export const serverEnvSchema = z.object({
  AUTH_SERVICE_URL: absoluteUrl,
  API_URL: absoluteUrl,
  MEDIA_BASE_URL: optionalAbsoluteUrl,
  MEDIA_SEGMENT_BASE_URL: optionalAbsoluteUrl,
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
