import { z } from "zod";

/**
 * What a project is made of, on the client. A project has one **input** (where
 * the content comes from) and one **output** (where the result goes). Both are
 * extensible registries: adding a source or destination means adding an entry
 * here, and the form grows automatically from its `fields`.
 *
 * Client-safe: no URLs, no secrets, no "job" terminology. The API happens to
 * call the upstream resource `jobs`; in this app it is always a project.
 */

export type ProjectFieldInputType = "url" | "text";

export interface ProjectField {
  /** Key in the upstream object for this side, e.g. `url`. */
  name: string;
  label: string;
  /** HTML input type used to render it. */
  inputType: ProjectFieldInputType;
  placeholder?: string;
  description?: string;
  /**
   * Value validation. Required for every field: the registry is the single
   * source of truth for what the form accepts and what the BFF forwards.
   */
  schema: z.ZodType<string>;
}

export interface ProjectKind {
  /** Also the `type` value sent upstream. */
  id: string;
  label: string;
  description: string;
  fields: readonly ProjectField[];
}

/** Hosts a link must belong to before it is treated as a YouTube video. */
export function isYouTubeHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    host === "youtu.be" ||
    host === "youtube.com" ||
    host.endsWith(".youtube.com")
  );
}

const youtubeUrl = z
  .string()
  .trim()
  .min(1, "Paste a video link.")
  .refine((value) => {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return false;
    }

    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    return isYouTubeHost(url.hostname);
  }, "Use a youtube.com or youtu.be link.");

/**
 * Sources the UI offers. The first entry is the default selection.
 *
 * Order of `fields` is the render order. Field names must not collide with
 * `type`; the schema builder below reserves it.
 */
export const PROJECT_INPUT_KINDS: readonly ProjectKind[] = [
  {
    id: "youtube",
    label: "YouTube",
    description: "Fetch a video from a public or unlisted link.",
    fields: [
      {
        name: "url",
        label: "Video URL",
        inputType: "url",
        placeholder: "https://www.youtube.com/watch?v=…",
        description: "A youtube.com or youtu.be link.",
        schema: youtubeUrl,
      },
    ],
  },
];

/** Destinations the UI offers. The first entry is the default selection. */
export const PROJECT_OUTPUT_KINDS: readonly ProjectKind[] = [
  {
    id: "s3",
    label: "S3 storage",
    description: "Save the finished result to S3.",
    fields: [],
  },
];

export function getProjectInputKind(id: string): ProjectKind | undefined {
  return PROJECT_INPUT_KINDS.find((kind) => kind.id === id);
}

export function getProjectOutputKind(id: string): ProjectKind | undefined {
  return PROJECT_OUTPUT_KINDS.find((kind) => kind.id === id);
}

/** Blank values for a kind's fields, used when the selection changes. */
export function emptyFieldValues(kind: ProjectKind): Record<string, string> {
  return Object.fromEntries(kind.fields.map((field) => [field.name, ""]));
}

export interface ProjectDraftValues {
  inputType: string;
  outputType: string;
  input: Record<string, string>;
  output: Record<string, string>;
}

function pickKnownFields(
  kind: ProjectKind | undefined,
  values: Record<string, string>,
): Record<string, string> {
  const picked: Record<string, string> = {};
  for (const field of kind?.fields ?? []) {
    picked[field.name] = values[field.name] ?? "";
  }
  return picked;
}

/**
 * Builds the request body from form values. Unknown selections are passed
 * through as-is so the shared schema rejects them on both sides instead of the
 * form silently inventing a default.
 */
export function buildProjectDraft(values: ProjectDraftValues): unknown {
  return {
    input: {
      type: values.inputType,
      ...pickKnownFields(getProjectInputKind(values.inputType), values.input),
    },
    output: {
      type: values.outputType,
      ...pickKnownFields(
        getProjectOutputKind(values.outputType),
        values.output,
      ),
    },
  };
}
