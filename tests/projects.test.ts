import { describe, expect, it } from "vitest";

import {
  projectCreateSchema,
  projectSchema,
  projectsListSchema,
} from "@/lib/api/schemas/projects";
import {
  PROJECT_INPUT_KINDS,
  PROJECT_OUTPUT_KINDS,
  buildProjectDraft,
  initialFieldValues,
  isYouTubeHost,
  projectStatusLabel,
  summarizeProjectInput,
} from "@/lib/projects";

const example = {
  input: { url: "https://youtu.be/sKJvJCsey84", type: "youtube" },
  output: { type: "s3" },
};

const gdriveExample = {
  input: {
    type: "gdrive",
    conn_id: "23d7949e-0f85-4a64-ab5b-a855e39fc3b5",
    file_id: "1AbCdEfGhIjKlMnOpQrStUvWxYz",
  },
  output: { type: "s3" },
};

describe("projectCreateSchema", () => {
  it("accepts the example payload", () => {
    const parsed = projectCreateSchema.safeParse(example);
    expect(parsed.success).toBe(true);
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
    expect(parsed.success && parsed.data).toEqual(gdriveExample);
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

    expect(draft).toEqual(gdriveExample);
    expect(projectCreateSchema.safeParse(draft).success).toBe(true);
  });
});

describe("initialFieldValues", () => {
  const gdriveKind = PROJECT_INPUT_KINDS.find((kind) => kind.id === "gdrive");

  it("defaults the Drive account to the first connected one", () => {
    const values = initialFieldValues(gdriveKind!, [
      { id: "23d7949e-0f85-4a64-ab5b-a855e39fc3b5" },
    ]);

    expect(values).toEqual({
      conn_id: "23d7949e-0f85-4a64-ab5b-a855e39fc3b5",
      file_id: "",
    });
  });

  it("leaves the Drive account blank when nothing is connected", () => {
    const values = initialFieldValues(gdriveKind!);

    expect(values).toEqual({ conn_id: "", file_id: "" });
  });

  it("does not invent values for kinds without a Drive account", () => {
    const youtube = PROJECT_INPUT_KINDS.find((kind) => kind.id === "youtube");

    expect(initialFieldValues(youtube!, [{ id: "ignored" }])).toEqual({
      url: "",
    });
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
    const controls = new Set(["text", "gdrive-account", "gdrive-file"]);

    for (const kind of kinds) {
      for (const field of kind.fields) {
        expect(controls.has(field.control), `${kind.id}.${field.name}`).toBe(
          true,
        );
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

describe("projectStatusLabel", () => {
  it("gives known statuses copy", () => {
    expect(projectStatusLabel("draft")).toBe("Draft");
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
