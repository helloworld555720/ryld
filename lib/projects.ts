import { Cloud, HardDrive, SquarePlay, type LucideIcon } from "lucide-react";
import { z } from "zod";

/**
 * What a project is made of, on the client. A project has one **input** (where
 * the content comes from) and one **output** (where the result goes). Both are
 * extensible registries: adding a source or destination means adding an entry
 * here, and the form grows automatically from its `fields`.
 *
 * A field declares both how it renders (`control`) and what the API receives
 * (`schema`). The schema is the single source of truth on both sides of the
 * BFF, so it accepts the form's representation *and* the wire representation
 * and normalises to the wire one — see the comment on `ProjectField.schema`.
 *
 * Client-safe: no URLs, no secrets, no "job" terminology. The API happens to
 * call the upstream resource `jobs`; in this app it is always a project.
 */

export type ProjectFieldInputType = "url" | "text";

/**
 * How the form renders a field:
 * - `text`, `textarea`, `numeric` — plain inputs (`text` uses `inputType`)
 * - `select` — a picker over `options`
 * - `switch` — a boolean toggle
 * - `datetime` — `datetime-local`, sent to the API as an ISO instant
 * - `connection-account` — the caller's connected accounts for `provider`
 * - `gdrive-file` — Google's Picker, fills a Drive file id
 */
export type ProjectFieldControl =
  | "text"
  | "textarea"
  | "select"
  | "switch"
  | "datetime"
  | "connection-account"
  | "gdrive-file";

export interface ProjectFieldOption {
  value: string;
  label: string;
}

/** What the form holds for one field: text, or a switch's boolean. */
export type ProjectFieldValue = string | boolean;

export interface ProjectField {
  /** Key in the upstream object for this side, e.g. `url`. */
  name: string;
  label: string;
  /** Which UI control renders this field. */
  control: ProjectFieldControl;
  /** HTML input type for `control: "text"`. */
  inputType?: ProjectFieldInputType;
  placeholder?: string;
  description?: string;
  /** Choices for `control: "select"`. */
  options?: readonly ProjectFieldOption[];
  /** Provider id a `connection-account` field selects from. */
  provider?: string;
  /** Value the form starts with; text falls back to "", switch to false. */
  defaultValue?: ProjectFieldValue;
  /** Subheading this field renders under, within its side. */
  group?: string;
  /** Overrides `fieldLayout()`'s default width in the two-column grid. */
  layout?: ProjectFieldLayout;
  /**
   * Validation *and* normalisation, used by the form and by the BFF alike.
   *
   * A field receives either the form's representation (a string, or a boolean
   * from a switch) or the wire representation (the already-normalised value,
   * because the client posts `projectCreateSchema`'s output). It must accept
   * both and be idempotent: empty text becomes `null`, a comma-separated list
   * becomes an array, `"true"` becomes `true`, a local datetime becomes an ISO
   * instant.
   */
  schema: z.ZodType;
}

export interface ProjectKind {
  /** Also the `type` value sent upstream. */
  id: string;
  label: string;
  description: string;
  /** Shown beside the label in the form and on a project card. */
  icon: LucideIcon;
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

/* -------------------------------------------------------------------------- */
/* Field schemas                                                              */
/* -------------------------------------------------------------------------- */

/** Empty text is `null` upstream, which is how the API stores "not set". */
function optionalText(max: number, message: string) {
  return z
    .string()
    .max(max, message)
    .nullable()
    .optional()
    .transform((value) => {
      const text = typeof value === "string" ? value.trim() : "";
      return text === "" ? null : text;
    });
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

const optionalHttpUrl = z
  .string()
  .nullable()
  .optional()
  .transform((value) => {
    const text = typeof value === "string" ? value.trim() : "";
    return text === "" ? null : text;
  })
  .refine(
    (value) => value === null || isHttpUrl(value),
    "Use an http(s) link.",
  );

/** "tag, tag" in the form, `["tag", "tag"]` on the wire (or `null`). */
const tagsSchema = z
  .union([z.array(z.string()), z.string()])
  .nullable()
  .optional()
  .transform((value) => {
    const list = Array.isArray(value)
      ? value
      : typeof value === "string"
        ? value.split(",")
        : [];

    const tags = list.map((tag) => tag.trim()).filter((tag) => tag.length > 0);
    return tags.length > 0 ? tags : null;
  })
  .refine(
    (tags) => tags === null || tags.length <= 30,
    "Use 30 tags or fewer.",
  )
  .refine(
    (tags) => tags === null || tags.every((tag) => tag.length <= 100),
    "Tags are 100 characters or fewer.",
  );

/** A switch value: the form's "true"/"false" or the wire's boolean. */
function booleanWith(fallback: boolean) {
  return z
    .union([z.boolean(), z.enum(["true", "false"])])
    .nullable()
    .optional()
    .transform((value) =>
      value == null ? fallback : value === true || value === "true",
    );
}

/** Tri-state: `"unset"` in the form, `null` on the wire. */
const optionalBoolean = z
  .union([z.boolean(), z.enum(["true", "false", "unset"])])
  .nullable()
  .optional()
  .transform((value) =>
    value == null || value === "unset"
      ? null
      : value === true || value === "true",
  );

/** `datetime-local` in the form (local time), an ISO instant on the wire. */
const optionalInstant = z
  .string()
  .nullable()
  .optional()
  .transform((value) => {
    const text = typeof value === "string" ? value.trim() : "";
    if (text === "") return null;

    const date = new Date(text);
    return Number.isNaN(date.getTime()) ? text : date.toISOString();
  })
  .refine(
    (value) => value === null || !Number.isNaN(Date.parse(value)),
    "Choose a valid date and time.",
  );

const optionalLanguage = optionalText(
  15,
  "Use a language code, like en or en-US.",
).refine(
  (value) => value === null || /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(value),
  "Use a language code, like en or en-US.",
);

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

/* -------------------------------------------------------------------------- */
/* Registries                                                                 */
/* -------------------------------------------------------------------------- */

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
    icon: SquarePlay,
    fields: [
      {
        name: "url",
        label: "Video URL",
        control: "text",
        inputType: "url",
        placeholder: "https://www.youtube.com/watch?v=…",
        description: "A youtube.com or youtu.be link.",
        schema: youtubeUrl,
      },
    ],
  },
  {
    /*
     * A Drive source is a file that already exists in a connected account. The
     * Picker fills `file_id`, and `conn_id` selects the account it belongs to;
     * both are forwarded so the API can read the file with that connection's
     * token.
     */
    id: "gdrive",
    label: "Google Drive",
    description: "Use a file from a connected Drive account.",
    icon: Cloud,
    fields: [
      {
        name: "conn_id",
        label: "Google Drive account",
        control: "connection-account",
        provider: "gdrive",
        description: "The connected account the file belongs to.",
        schema: z.uuid({ error: "Choose a Google Drive account." }),
      },
      {
        name: "file_id",
        label: "File",
        control: "gdrive-file",
        description: "Only files Ryld can access are listed.",
        schema: z.string().trim().min(1, "Choose a file."),
      },
    ],
  },
];

/**
 * YouTube's assignable upload categories. The ids are the stable part; the
 * labels are the names YouTube shows in most regions. `22` (People & Blogs) is
 * the default the API applies when `category_id` is omitted.
 */
export const YOUTUBE_CATEGORIES: readonly ProjectFieldOption[] = [
  { value: "1", label: "Film & Animation" },
  { value: "2", label: "Autos & Vehicles" },
  { value: "10", label: "Music" },
  { value: "15", label: "Pets & Animals" },
  { value: "17", label: "Sports" },
  { value: "19", label: "Travel & Events" },
  { value: "20", label: "Gaming" },
  { value: "22", label: "People & Blogs" },
  { value: "23", label: "Comedy" },
  { value: "24", label: "Entertainment" },
  { value: "25", label: "News & Politics" },
  { value: "26", label: "Howto & Style" },
  { value: "27", label: "Education" },
  { value: "28", label: "Science & Technology" },
  { value: "29", label: "Nonprofits & Activism" },
];

const categorySchema = z.enum(
  YOUTUBE_CATEGORIES.map((category) => category.value),
);

/** Destinations the UI offers. The first entry is the default selection. */
export const PROJECT_OUTPUT_KINDS: readonly ProjectKind[] = [
  {
    id: "s3",
    label: "S3 storage",
    description: "Save the finished result to S3.",
    icon: HardDrive,
    fields: [],
  },
  {
    /*
     * Publishing to YouTube. The API accepts, and echoes back, the whole upload
     * metadata block — so every field below is part of the contract, with the
     * same defaults the API applies when it is omitted (private, category 22,
     * embeddable, public stats).
     */
    id: "youtube",
    label: "YouTube",
    description: "Publish the result to a connected channel.",
    icon: SquarePlay,
    fields: [
      {
        name: "conn_id",
        label: "YouTube account",
        control: "connection-account",
        provider: "youtube",
        description: "The channel the video is uploaded to.",
        schema: z.uuid({ error: "Choose a YouTube account." }),
      },
      {
        name: "title",
        label: "Title",
        control: "text",
        placeholder: "Video title",
        description: "Up to 100 characters. Left empty, YouTube chooses one.",
        schema: optionalText(100, "Titles are 100 characters or fewer."),
      },
      {
        name: "privacy",
        label: "Privacy",
        control: "select",
        options: [
          { value: "private", label: "Private" },
          { value: "unlisted", label: "Unlisted" },
          { value: "public", label: "Public" },
        ],
        defaultValue: "private",
        description: "Private until you publish it yourself.",
        schema: z.enum(["private", "unlisted", "public"]),
      },
      {
        name: "category_id",
        label: "Category",
        control: "select",
        options: YOUTUBE_CATEGORIES,
        defaultValue: "22",
        description: "The YouTube category the video is filed under.",
        schema: categorySchema,
      },
      {
        name: "description",
        label: "Description",
        control: "textarea",
        group: "Details",
        placeholder: "What is this video about?",
        description: "Up to 5000 characters.",
        schema: optionalText(5000, "Descriptions are 5000 characters or fewer."),
      },
      {
        name: "tags",
        label: "Tags",
        control: "text",
        group: "Details",
        placeholder: "tutorial, demo",
        description: "Separate tags with commas.",
        schema: tagsSchema,
      },
      {
        name: "default_language",
        label: "Language",
        control: "text",
        group: "Details",
        layout: "half",
        placeholder: "en",
        description: "A language code, like en or en-US.",
        schema: optionalLanguage,
      },
      {
        name: "publish_at",
        label: "Publish at",
        control: "datetime",
        group: "Details",
        description: "Optional. Your local time; sent as an instant.",
        schema: optionalInstant,
      },
      {
        name: "thumbnail_url",
        label: "Thumbnail URL",
        control: "text",
        inputType: "url",
        group: "Details",
        placeholder: "https://…",
        description: "Optional. A JPEG or PNG YouTube can fetch.",
        schema: optionalHttpUrl,
      },
      {
        name: "embeddable",
        label: "Embeddable",
        control: "switch",
        group: "Playback",
        defaultValue: true,
        description: "Let other sites embed the video.",
        schema: booleanWith(true),
      },
      {
        name: "public_stats_viewable",
        label: "Public stats",
        control: "switch",
        group: "Playback",
        defaultValue: true,
        description: "Show the like count publicly.",
        schema: booleanWith(true),
      },
      {
        name: "made_for_kids",
        label: "Made for kids",
        control: "switch",
        group: "Audience",
        defaultValue: false,
        description: "YouTube requires this for content aimed at children.",
        schema: booleanWith(false),
      },
      {
        name: "contains_synthetic_media",
        label: "Altered content",
        control: "select",
        group: "Audience",
        options: [
          { value: "unset", label: "Not specified" },
          { value: "true", label: "Yes, altered or synthetic" },
          { value: "false", label: "No" },
        ],
        defaultValue: "unset",
        description: "Disclose realistic synthetic media.",
        schema: optionalBoolean,
      },
    ],
  },
];

export function getProjectInputKind(id: string): ProjectKind | undefined {
  return PROJECT_INPUT_KINDS.find((kind) => kind.id === id);
}

export function getProjectOutputKind(id: string): ProjectKind | undefined {
  return PROJECT_OUTPUT_KINDS.find((kind) => kind.id === id);
}

/** Fields that hold a value the user can edit (everything but layout glue). */
export type ProjectFieldLayout = "full" | "half";

/**
 * Width of a field in the two-column grid. An entry can override it per field;
 * otherwise long-form editing gets the full row and pickers and toggles pair
 * up.
 */
export function fieldLayout(field: ProjectField): ProjectFieldLayout {
  if (field.layout) return field.layout;

  switch (field.control) {
    case "select":
    case "switch":
    case "datetime":
      return "half";
    default:
      return "full";
  }
}

function defaultValueFor(field: ProjectField): ProjectFieldValue {
  if (field.control === "switch") {
    return typeof field.defaultValue === "boolean" ? field.defaultValue : false;
  }

  return typeof field.defaultValue === "string" ? field.defaultValue : "";
}

/** Blank values for a kind's fields, used when the selection changes. */
export function emptyFieldValues(kind: ProjectKind): Record<string, ProjectFieldValue> {
  const values: Record<string, ProjectFieldValue> = {};

  for (const field of kind.fields) {
    values[field.name] = defaultValueFor(field);
  }

  return values;
}

/** The minimum a connected account has to expose to the form. */
export interface ConnectedAccount {
  id: string;
  type: string;
}

/**
 * Starting values for a kind.
 *
 * A `connection-account` field defaults to the first account the caller has for
 * that provider — a Drive source needs a connection id before the Picker can
 * mint a token, and a YouTube destination needs a channel before it can
 * publish. With no account the value stays blank and the field explains what is
 * missing.
 */
export function initialFieldValues(
  kind: ProjectKind,
  accounts: readonly ConnectedAccount[] = [],
): Record<string, ProjectFieldValue> {
  const values = emptyFieldValues(kind);

  for (const field of kind.fields) {
    if (field.control !== "connection-account" || !field.provider) continue;

    const first = accounts.find((account) => account.type === field.provider);
    values[field.name] = first?.id ?? "";
  }

  return values;
}

export interface ProjectDraftValues {
  inputType: string;
  outputType: string;
  input: Record<string, ProjectFieldValue>;
  output: Record<string, ProjectFieldValue>;
  /**
   * `true` asks the API to queue the project instead of leaving it a draft.
   * Omitted means draft, which is also the API's default.
   */
  submit?: boolean;
}

function pickKnownFields(
  kind: ProjectKind | undefined,
  values: Record<string, ProjectFieldValue>,
): Record<string, ProjectFieldValue> {
  const picked: Record<string, ProjectFieldValue> = {};
  for (const field of kind?.fields ?? []) {
    picked[field.name] = values[field.name] ?? defaultValueFor(field);
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
    // Always explicit: the two actions in the dialog differ only here.
    submit: values.submit === true,
  };
}

/** One label/value pair rendered on a project card. */
export interface ProjectFieldSummary {
  label: string;
  value: string;
}

/**
 * The stored input fields worth showing, in registry order.
 *
 * Only fields the registry declares are read, and only when the stored value is
 * a non-empty string — the shape comes from the API, so anything unexpected is
 * dropped instead of being rendered as `[object Object]`.
 */
export function summarizeProjectInput(
  type: string,
  input: Readonly<Record<string, unknown>>,
): ProjectFieldSummary[] {
  const kind = getProjectInputKind(type);
  if (!kind) return [];

  const rows: ProjectFieldSummary[] = [];
  for (const field of kind.fields) {
    const value = input[field.name];
    if (typeof value === "string" && value.trim() !== "") {
      rows.push({ label: field.label, value });
    }
  }

  return rows;
}

/**
 * Upstream `status` is an open string (only `draft` has been observed), so
 * known values get copy and anything else is shown as the API sent it.
 */
const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  pending: "Pending",
  queued: "Queued",
  processing: "Processing",
  completed: "Completed",
  failed: "Failed",
};

export function projectStatusLabel(status: string): string {
  return STATUS_LABELS[status.toLowerCase()] ?? status;
}
