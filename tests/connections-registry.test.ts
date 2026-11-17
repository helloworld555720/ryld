import { describe, expect, it } from "vitest";

import {
  CONNECTION_CATEGORIES,
  CONNECTION_PROVIDERS,
  countAccountsByCategory,
  getConnectionCategory,
  groupConnectionsByProvider,
  resolveConnectionCategory,
} from "@/lib/connections";

const YOUTUBE_A = { id: "7eb3f330-0000-0000-0000-000000000000", type: "youtube" };
const YOUTUBE_B = { id: "1a2b3c4d-0000-0000-0000-000000000000", type: "youtube" };

describe("connection categories", () => {
  it("defines Socials and Storage, in that tab order", () => {
    expect(CONNECTION_CATEGORIES.map((category) => category.id)).toEqual([
      "socials",
      "storage",
    ]);
  });

  it("files every provider under a category that exists", () => {
    const ids = CONNECTION_CATEGORIES.map((category) => category.id);

    for (const provider of CONNECTION_PROVIDERS) {
      expect(ids).toContain(provider.category);
    }
  });

  it("puts YouTube in Socials", () => {
    expect(CONNECTION_PROVIDERS.find((p) => p.id === "youtube")?.category).toBe(
      "socials",
    );
  });

  it("puts Google Drive in Storage", () => {
    const gdrive = CONNECTION_PROVIDERS.find(
      (provider) => provider.id === "gdrive",
    );

    expect(gdrive?.category).toBe("storage");
    expect(gdrive?.label).toBe("Google Drive");
  });

  it("resolves a known tab", () => {
    expect(resolveConnectionCategory("storage").id).toBe("storage");
  });

  it("falls back to the first category for missing or unknown tabs", () => {
    for (const raw of [undefined, "", "nope", "SOCIALS", "../socials"]) {
      expect(resolveConnectionCategory(raw).id).toBe(
        CONNECTION_CATEGORIES[0].id,
      );
    }
  });

  it("does not resolve tabs that are not in the registry", () => {
    expect(getConnectionCategory("commerce")).toBeUndefined();
  });
});

describe("groupConnectionsByProvider", () => {
  it("keeps every account of one provider, in API order", () => {
    const [group] = groupConnectionsByProvider([YOUTUBE_A, YOUTUBE_B]);

    expect(group.provider.id).toBe("youtube");
    expect(group.accounts.map((account) => account.id)).toEqual([
      YOUTUBE_A.id,
      YOUTUBE_B.id,
    ]);
  });

  it("still returns providers with no accounts", () => {
    const groups = groupConnectionsByProvider([]);

    expect(groups).toHaveLength(CONNECTION_PROVIDERS.length);
    expect(groups.every((group) => group.accounts.length === 0)).toBe(true);
  });

  it("drops types the registry does not know", () => {
    const vimeo = { id: "x", type: "vimeo" };
    const groups = groupConnectionsByProvider([vimeo, YOUTUBE_A]);

    const total = groups.reduce(
      (sum, group) => sum + group.accounts.length,
      0,
    );
    expect(total).toBe(1);
  });
});

describe("countAccountsByCategory", () => {
  it("counts accounts, not providers", () => {
    expect(countAccountsByCategory([YOUTUBE_A, YOUTUBE_B])).toEqual({
      socials: 2,
      storage: 0,
    });
  });

  it("returns zeroes for an empty list", () => {
    expect(countAccountsByCategory([])).toEqual({ socials: 0, storage: 0 });
  });

  it("ignores types the registry does not know", () => {
    const vimeo = { id: "x", type: "vimeo" };
    expect(countAccountsByCategory([vimeo])).toEqual({
      socials: 0,
      storage: 0,
    });
  });
});
