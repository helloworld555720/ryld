import { describe, expect, it } from "vitest";

import {
  projectCreateSchema,
  projectSchema,
  projectsListSchema,
} from "@/lib/api/schemas/projects";
import {
  PROJECT_INPUT_KINDS,
  PROJECT_OUTPUT_KINDS,
  PROJECT_SOURCE_KINDS,
  buildProjectDraft,
  fieldLayout,
  initialFieldValues,
  isYouTubeHost,
  projectStatusLabel,
  summarizeProjectInput,
  summarizeProjectSource,
} from "@/lib/projects";

const YOUTUBE_CONNECTION = "a00501a9-b033-448e-9a38-cc67655c508f";
const GDRIVE_CONNECTION = "23d7949e-0f85-4a64-ab5b-a855e39fc3b5";

const example = {
  input: { url: "https://youtu.be/sKJvJCsey84", type: "youtube" },
  output: { type: "s3" },
};

const gdriveExample = {
  input: {
    type: "gdrive",
    conn_id: GDRIVE_CONNECTION,
    file_id: "1AbCdEfGhIjKlMnOpQrStUvWxYz",
  },
  output: { type: "s3" },
};

/** The output block the API echoes back for a YouTube destination. */
const youtubeOutput = {
  type: "youtube",
  conn_id: YOUTUBE_CONNECTION,
  title: null,
  description: null,
  tags: null,
  category_id: "22",
  default_language: null,
  privacy: "private",
  publish_at: null,
  embeddable: true,
  public_stats_viewable: true,
  made_for_kids: false,
  contains_synthetic_media: null,
  thumbnail_url: null,
};

/** The result block the API fills in once a project has been processed. */
const completedSource = {
  title: "Rick Astley - Never Gonna Give You Up (Official Video) (4K Remaster)",
  playlist: "79b7ea43c1fd45629757a55397e83a3b/master.m3u8",
  poster: "79b7ea43c1fd45629757a55397e83a3b/thumbnail.jpg",
  thumbnails: "79b7ea43c1fd45629757a55397e83a3b/storyboard.vtt",
  captions: "79b7ea43c1fd45629757a55397e83a3b/captions.vtt",
  chapters: "79b7ea43c1fd45629757a55397e83a3b/chapters.vtt",
  type: "hls",
};

describe("projectCreateSchema", () => {
  it("accepts the example payload", () => {
    const parsed = projectCreateSchema.safeParse(example);
    expect(parsed.success).toBe(true);
  });

  it("defaults submit to false, which leaves a draft", () => {
    const parsed = projectCreateSchema.safeParse(example);

    expect(parsed.success && parsed.data.submit).toBe(false);
  });

  it("keeps submit true so the API queues the project", () => {
    const parsed = projectCreateSchema.safeParse({ ...example, submit: true });

    expect(parsed.success && parsed.data.submit).toBe(true);
  });

  it("rejects a submit value that is not a boolean", () => {
    const parsed = projectCreateSchema.safeParse({
      ...example,
      submit: "true",
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects a link that is not from YouTube", () => {
    const parsed = projectCreateSchema.safeParse({
      ...example,
      input: { type: "youtube", url: "https://example.com/watch?v=1" },
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a missing or malformed url", () => {
    for (const url of ["", "   ", "not a url", "javascript:alert(1)"]) {
      const parsed = projectCreateSchema.safeParse({
        ...example,
        input: { type: "youtube", url },
      });
      expect(parsed.success, url).toBe(false);
    }
  });

  it("rejects input or output types that are not registered", () => {
    expect(
      projectCreateSchema.safeParse({
        ...example,
        input: { type: "vimeo", url: "https://vimeo.com/1" },
      }).success,
    ).toBe(false);

    expect(
      projectCreateSchema.safeParse({
        ...example,
        output: { type: "dropbox" },
      }).success,
    ).toBe(false);
  });

  it("drops fields the selected kind does not declare", () => {
    const parsed = projectCreateSchema.safeParse({
      input: { type: "youtube", url: "https://youtu.be/abc", surprise: "x" },
      output: { type: "s3", bucket: "somewhere" },
    });

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data).toEqual({
      input: { type: "youtube", url: "https://youtu.be/abc" },
      output: { type: "s3" },
      submit: false,
    });
  });

  it("accepts a Google Drive source with a connection and file id", () => {
    expect(projectCreateSchema.safeParse(gdriveExample).success).toBe(true);
  });

  it("requires a real connection id and a file id for Drive", () => {
    for (const input of [
      { type: "gdrive", conn_id: "not-a-uuid", file_id: "file" },
      { type: "gdrive", conn_id: "", file_id: "file" },
      {
        type: "gdrive",
        conn_id: "23d7949e-0f85-4a64-ab5b-a855e39fc3b5",
        file_id: "",
      },
      { type: "gdrive", conn_id: "23d7949e-0f85-4a64-ab5b-a855e39fc3b5" },
    ]) {
      expect(
        projectCreateSchema.safeParse({ ...gdriveExample, input }).success,
        JSON.stringify(input),
      ).toBe(false);
    }
  });

  it("drops extra keys on a Drive input", () => {
    const parsed = projectCreateSchema.safeParse({
      ...gdriveExample,
      input: { ...gdriveExample.input, file_name: "not forwarded" },
    });

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data).toEqual({
      ...gdriveExample,
      submit: false,
    });
  });

  it("accepts the YouTube destination the API echoes back", () => {
    const parsed = projectCreateSchema.safeParse({
      ...gdriveExample,
      output: youtubeOutput,
    });

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data).toEqual({
      ...gdriveExample,
      output: youtubeOutput,
      submit: false,
    });
  });

  it("normalises the form's representation of each YouTube option", () => {
    const parsed = projectCreateSchema.safeParse({
      ...gdriveExample,
      output: {
        type: "youtube",
        conn_id: YOUTUBE_CONNECTION,
        title: "  Launch  ",
        description: "   ",
        tags: " demo , tutorial, ",
        category_id: "28",
        default_language: "en",
        privacy: "unlisted",
        publish_at: "2027-01-01T10:00",
        embeddable: "false",
        public_stats_viewable: "true",
        made_for_kids: "false",
        contains_synthetic_media: "unset",
        thumbnail_url: "https://example.com/thumb.jpg",
      },
    });

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    const output = parsed.data.output as Record<string, unknown>;
    expect(output).toMatchObject({
      title: "Launch",
      description: null,
      tags: ["demo", "tutorial"],
      category_id: "28",
      default_language: "en",
      privacy: "unlisted",
      embeddable: false,
      public_stats_viewable: true,
      made_for_kids: false,
      contains_synthetic_media: null,
      thumbnail_url: "https://example.com/thumb.jpg",
    });
    expect(Date.parse(String(output.publish_at))).toBe(
      new Date("2027-01-01T10:00").getTime(),
    );
  });

  it("rejects a YouTube destination without a real connection id", () => {
    for (const conn_id of [undefined, "", "not-a-uuid"]) {
      const parsed = projectCreateSchema.safeParse({
        ...gdriveExample,
        output: { ...youtubeOutput, conn_id },
      });
      expect(parsed.success, String(conn_id)).toBe(false);
    }
  });

  it("rejects a privacy value YouTube does not offer", () => {
    const parsed = projectCreateSchema.safeParse({
      ...gdriveExample,
      output: { ...youtubeOutput, privacy: "friends-only" },
    });

    expect(parsed.success).toBe(false);
  });
});

describe("projectSchema", () => {
  it("reads the shape the API returned on creation", () => {
    const parsed = projectSchema.safeParse({
      ...example,
      id: "990685c9-ddad-4d58-ac59-eafe1965f15f",
      status: "draft",
      source: null,
    });

    expect(parsed.success).toBe(true);
  });

  it("requires an id, a status and both sides", () => {
    expect(projectSchema.safeParse(example).success).toBe(false);
  });

  it("reads a submitted project, which is pending rather than a draft", () => {
    const parsed = projectSchema.safeParse({
      ...example,
      id: "e717898a-5209-474d-8917-4925885e5fe9",
      status: "pending",
      source: null,
      submit: true,
    });

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.status).toBe("pending");
  });

  it("still reads an older project with no submit field", () => {
    const parsed = projectSchema.safeParse({
      ...example,
      id: "4f16f26a-0db3-4665-8cdd-c91e3a95c768",
      status: "draft",
      source: null,
    });

    expect(parsed.success).toBe(true);
  });

  it("reads the result a completed project reports in source", () => {
    const parsed = projectSchema.safeParse({
      ...example,
      id: "e6bef3ab-33e7-427f-a979-1fbf94a31e10",
      status: "completed",
      source: completedSource,
      submit: true,
    });

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.source).toEqual(completedSource);
  });

  it("keeps result kinds it does not know, so one new kind cannot fail the list", () => {
    const parsed = projectSchema.safeParse({
      ...example,
      id: "e6bef3ab-33e7-427f-a979-1fbf94a31e10",
      status: "completed",
      source: { type: "mp4", file: "out.mp4" },
    });

    expect(parsed.success).toBe(true);
  });

  it("rejects a source that is not an object with a type", () => {
    for (const source of ["hls", 42, {}, { title: "no type" }]) {
      expect(
        projectSchema.safeParse({
          ...example,
          id: "e6bef3ab-33e7-427f-a979-1fbf94a31e10",
          status: "completed",
          source,
        }).success,
        JSON.stringify(source),
      ).toBe(false);
    }
  });
});

describe("projectsListSchema", () => {
  const stored = {
    ...gdriveExample,
    id: "10624453-8527-4134-acdb-f4ceda0d94d1",
    status: "draft",
    source: null,
  };

  it("accepts the array the API returns, and an empty one", () => {
    expect(projectsListSchema.parse([stored])).toEqual([stored]);
    expect(projectsListSchema.parse([])).toEqual([]);
  });

  it("rejects a single project where an array is expected", () => {
    expect(projectsListSchema.safeParse(stored).success).toBe(false);
  });

  it("rejects an item with no id, so a card cannot key on undefined", () => {
    const withoutId = {
      input: stored.input,
      output: stored.output,
      status: stored.status,
      source: stored.source,
    };

    expect(projectsListSchema.safeParse([withoutId]).success).toBe(false);
  });
});

describe("buildProjectDraft", () => {
  it("sends only the fields the registry declares", () => {
    const draft = buildProjectDraft({
      inputType: "youtube",
      outputType: "s3",
      input: { url: "https://youtu.be/abc", ignored: "x" },
      output: { bucket: "somewhere" },
    });

    expect(draft).toEqual({
      input: { type: "youtube", url: "https://youtu.be/abc" },
      output: { type: "s3" },
      submit: false,
    });
  });

  it("passes unknown selections through so the schema rejects them", () => {
    const draft = buildProjectDraft({
      inputType: "vimeo",
      outputType: "s3",
      input: {},
      output: {},
    });

    expect(draft).toEqual({
      input: { type: "vimeo" },
      output: { type: "s3" },
      submit: false,
    });
    expect(projectCreateSchema.safeParse(draft).success).toBe(false);
  });

  it("sends the Drive connection and file, and nothing else", () => {
    const draft = buildProjectDraft({
      inputType: "gdrive",
      outputType: "s3",
      input: {
        conn_id: gdriveExample.input.conn_id,
        file_id: gdriveExample.input.file_id,
        file_name: "not forwarded",
      },
      output: {},
    });

    expect(draft).toEqual({ ...gdriveExample, submit: false });
    expect(projectCreateSchema.safeParse(draft).success).toBe(true);
  });

  it("fills a YouTube destination with the API's defaults", () => {
    const draft = buildProjectDraft({
      inputType: "youtube",
      outputType: "youtube",
      input: { url: "https://youtu.be/abc" },
      output: { conn_id: YOUTUBE_CONNECTION },
    });

    expect(draft).toEqual({
      input: { type: "youtube", url: "https://youtu.be/abc" },
      output: {
        type: "youtube",
        conn_id: YOUTUBE_CONNECTION,
        title: "",
        privacy: "private",
        category_id: "22",
        description: "",
        tags: "",
        default_language: "",
        publish_at: "",
        thumbnail_url: "",
        embeddable: true,
        public_stats_viewable: true,
        made_for_kids: false,
        contains_synthetic_media: "unset",
      },
      submit: false,
    });
    expect(projectCreateSchema.safeParse(draft).success).toBe(true);
  });

  it("asks the API to queue the project when submitted", () => {
    const draft = buildProjectDraft({
      inputType: "youtube",
      outputType: "s3",
      input: { url: "https://youtu.be/abc" },
      output: {},
      submit: true,
    });

    expect(draft).toMatchObject({ submit: true });
    expect(projectCreateSchema.safeParse(draft).success).toBe(true);
  });
});

describe("initialFieldValues", () => {
  const gdriveKind = PROJECT_INPUT_KINDS.find((kind) => kind.id === "gdrive");
  const youtubeOutputKind = PROJECT_OUTPUT_KINDS.find(
    (kind) => kind.id === "youtube",
  );

  it("defaults the Drive account to the first connected one", () => {
    const values = initialFieldValues(gdriveKind!, [
      { id: GDRIVE_CONNECTION, type: "gdrive" },
    ]);

    expect(values).toEqual({
      conn_id: GDRIVE_CONNECTION,
      file_id: "",
    });
  });

  it("leaves the Drive account blank when nothing is connected", () => {
    const values = initialFieldValues(gdriveKind!);

    expect(values).toEqual({ conn_id: "", file_id: "" });
  });

  it("defaults the YouTube destination to the first channel and the API's options", () => {
    const values = initialFieldValues(youtubeOutputKind!, [
      { id: GDRIVE_CONNECTION, type: "gdrive" },
      { id: YOUTUBE_CONNECTION, type: "youtube" },
    ]);

    expect(values).toMatchObject({
      conn_id: YOUTUBE_CONNECTION,
      title: "",
      privacy: "private",
      category_id: "22",
      embeddable: true,
      public_stats_viewable: true,
      made_for_kids: false,
      contains_synthetic_media: "unset",
    });
  });

  it("leaves the YouTube channel blank when no channel is connected", () => {
    const values = initialFieldValues(youtubeOutputKind!, [
      { id: GDRIVE_CONNECTION, type: "gdrive" },
    ]);

    expect(values.conn_id).toBe("");
  });

  it("does not invent values for kinds without an account field", () => {
    const youtube = PROJECT_INPUT_KINDS.find((kind) => kind.id === "youtube");

    expect(
      initialFieldValues(youtube!, [{ id: "ignored", type: "youtube" }]),
    ).toEqual({ url: "" });
  });
});

describe("registries", () => {
  const kinds = [...PROJECT_INPUT_KINDS, ...PROJECT_OUTPUT_KINDS];

  it("has a default kind for each side", () => {
    expect(PROJECT_INPUT_KINDS.length).toBeGreaterThan(0);
    expect(PROJECT_OUTPUT_KINDS.length).toBeGreaterThan(0);
  });

  it("uses unique ids within each side", () => {
    for (const list of [PROJECT_INPUT_KINDS, PROJECT_OUTPUT_KINDS]) {
      const ids = list.map((kind) => kind.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("never lets a field collide with the reserved type key", () => {
    for (const kind of kinds) {
      const names = kind.fields.map((field) => field.name);
      expect(names).not.toContain("type");
      expect(new Set(names).size).toBe(names.length);
    }
  });

  it("offers YouTube and Google Drive as sources", () => {
    const ids = PROJECT_INPUT_KINDS.map((kind) => kind.id);

    expect(ids).toContain("youtube");
    expect(ids).toContain("gdrive");
  });

  it("declares a control for every field that the form understands", () => {
    const controls = new Set([
      "text",
      "textarea",
      "select",
      "switch",
      "datetime",
      "connection-account",
      "gdrive-file",
    ]);

    for (const kind of kinds) {
      for (const field of kind.fields) {
        expect(controls.has(field.control), `${kind.id}.${field.name}`).toBe(
          true,
        );
      }
    }
  });

  it("offers YouTube as a destination with the API's upload options", () => {
    const youtube = PROJECT_OUTPUT_KINDS.find((kind) => kind.id === "youtube");

    expect(youtube).toBeDefined();
    expect(youtube!.fields.map((field) => field.name)).toEqual([
      "conn_id",
      "title",
      "privacy",
      "category_id",
      "description",
      "tags",
      "default_language",
      "publish_at",
      "thumbnail_url",
      "embeddable",
      "public_stats_viewable",
      "made_for_kids",
      "contains_synthetic_media",
    ]);
  });

  it("pairs half-width fields so the two-column grid has no holes", () => {
    const youtube = PROJECT_OUTPUT_KINDS.find((kind) => kind.id === "youtube");
    let width = 0;
    let groupTitle: string | null | undefined;

    for (const field of youtube!.fields) {
      const title = field.group ?? null;
      if (title !== groupTitle) {
        expect(width, `row left open before ${title ?? "the first group"}`).toBe(
          0,
        );
        width = 0;
        groupTitle = title;
      }

      width += fieldLayout(field) === "half" ? 1 : 2;
      if (width >= 2) {
        expect(width, `${groupTitle ?? "first"}.${field.name}`).toBe(2);
        width = 0;
      }
    }

    expect(width, "row left open at the end").toBe(0);
  });

  it("opts every select into a default, so the first render is valid", () => {
    for (const kind of kinds) {
      for (const field of kind.fields) {
        if (field.control !== "select") continue;
        expect(field.defaultValue, `${kind.id}.${field.name}`).toBeDefined();
      }
    }
  });

  it("gives every kind an icon for its card", () => {
    for (const kind of kinds) {
      expect(kind.icon, kind.id).toBeTruthy();
    }
  });
});

describe("summarizeProjectInput", () => {
  it("returns the registry's fields in registry order", () => {
    expect(
      summarizeProjectInput("gdrive", gdriveExample.input),
    ).toEqual([
      { label: "Google Drive account", value: gdriveExample.input.conn_id },
      { label: "File", value: gdriveExample.input.file_id },
    ]);
  });

  it("reads a YouTube link from the stored input", () => {
    expect(summarizeProjectInput("youtube", example.input)).toEqual([
      { label: "Video URL", value: "https://youtu.be/sKJvJCsey84" },
    ]);
  });

  it("drops fields the registry does not declare", () => {
    expect(
      summarizeProjectInput("youtube", {
        url: "https://youtu.be/abc",
        secret: "never rendered",
      }),
    ).toEqual([{ label: "Video URL", value: "https://youtu.be/abc" }]);
  });

  it("drops empty and non-string values instead of rendering them", () => {
    expect(
      summarizeProjectInput("gdrive", {
        conn_id: "  ",
        file_id: { nested: true },
      }),
    ).toEqual([]);
  });

  it("returns nothing for a type the registry does not know", () => {
    expect(summarizeProjectInput("vimeo", { url: "https://vimeo.com/1" })).toEqual(
      [],
    );
  });
});

describe("summarizeProjectSource", () => {
  it("reads the artefacts of a processed project in registry order", () => {
    expect(summarizeProjectSource(completedSource)).toEqual([
      { label: "Title", value: completedSource.title },
      { label: "Playlist", value: completedSource.playlist },
      { label: "Poster", value: completedSource.poster },
      { label: "Thumbnails", value: completedSource.thumbnails },
      { label: "Captions", value: completedSource.captions },
      { label: "Chapters", value: completedSource.chapters },
    ]);
  });

  it("drops fields the registry does not declare", () => {
    expect(
      summarizeProjectSource({ type: "hls", playlist: "a/master.m3u8", key: "x" }),
    ).toEqual([{ label: "Playlist", value: "a/master.m3u8" }]);
  });

  it("drops empty and non-string values instead of rendering them", () => {
    expect(
      summarizeProjectSource({ type: "hls", title: "  ", playlist: [1, 2] }),
    ).toEqual([]);
  });

  it("returns nothing for a result kind the registry does not know", () => {
    expect(summarizeProjectSource({ type: "mp4", file: "out.mp4" })).toEqual([]);
    expect(summarizeProjectSource({ playlist: "a/master.m3u8" })).toEqual([]);
  });

  it("declares a label for every result kind", () => {
    for (const kind of PROJECT_SOURCE_KINDS) {
      expect(kind.id, kind.label).not.toBe("");
      expect(kind.label).not.toBe("");
      expect(kind.fields.length).toBeGreaterThan(0);
    }
  });
});

describe("projectStatusLabel", () => {
  it("gives known statuses copy", () => {
    expect(projectStatusLabel("draft")).toBe("Draft");
    expect(projectStatusLabel("pending")).toBe("Pending");
    expect(projectStatusLabel("Processing")).toBe("Processing");
    expect(projectStatusLabel("COMPLETED")).toBe("Completed");
    expect(projectStatusLabel("failed")).toBe("Failed");
  });

  it("shows an unknown status as the API sent it", () => {
    expect(projectStatusLabel("awaiting_review")).toBe("awaiting_review");
  });
});

describe("isYouTubeHost", () => {
  it("accepts the hosts YouTube actually links to", () => {
    for (const host of [
      "youtube.com",
      "www.youtube.com",
      "m.youtube.com",
      "youtu.be",
      "YOUTU.BE",
    ]) {
      expect(isYouTubeHost(host), host).toBe(true);
    }
  });

  it("rejects lookalikes and other sites", () => {
    for (const host of [
      "notyoutube.com",
      "youtube.com.evil.com",
      "evil.com",
      "youtu.be.evil.com",
      "",
    ]) {
      expect(isYouTubeHost(host), host).toBe(false);
    }
  });
});
