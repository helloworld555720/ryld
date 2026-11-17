import { describe, expect, it } from "vitest";

import {
  projectCreateSchema,
  projectSchema,
} from "@/lib/api/schemas/projects";
import {
  PROJECT_INPUT_KINDS,
  PROJECT_OUTPUT_KINDS,
  buildProjectDraft,
  isYouTubeHost,
} from "@/lib/projects";

const example = {
  input: { url: "https://youtu.be/sKJvJCsey84", type: "youtube" },
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
