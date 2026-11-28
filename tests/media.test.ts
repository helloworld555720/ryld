import { describe, expect, it } from "vitest";

import {
  levelsUrl,
  projectMedia,
  resolveMediaUrl,
  sourceTitle,
} from "@/lib/media";

const BASE = "https://media.example.com";
const PREFIX = "79b7ea43c1fd45629757a55397e83a3b";

const hlsSource = {
  type: "hls",
  title: "Rick Astley - Never Gonna Give You Up (Official Video) (4K Remaster)",
  playlist: `${PREFIX}/master.m3u8`,
  poster: `${PREFIX}/thumbnail.jpg`,
  thumbnails: `${PREFIX}/storyboard.vtt`,
  captions: `${PREFIX}/captions.vtt`,
  chapters: `${PREFIX}/chapters.vtt`,
};

describe("resolveMediaUrl", () => {
  it("joins a stored key onto the base", () => {
    expect(resolveMediaUrl(BASE, `${PREFIX}/master.m3u8`)).toBe(
      `${BASE}/${PREFIX}/master.m3u8`,
    );
  });

  it("never doubles or drops the slash between base and key", () => {
    expect(resolveMediaUrl(`${BASE}/`, `${PREFIX}/master.m3u8`)).toBe(
      `${BASE}/${PREFIX}/master.m3u8`,
    );
    expect(resolveMediaUrl(BASE, `/${PREFIX}/master.m3u8`)).toBe(
      `${BASE}/${PREFIX}/master.m3u8`,
    );
    expect(resolveMediaUrl(`${BASE}///`, `///${PREFIX}/master.m3u8`)).toBe(
      `${BASE}/${PREFIX}/master.m3u8`,
    );
  });

  it("returns null when nothing can be built", () => {
    expect(resolveMediaUrl(undefined, `${PREFIX}/master.m3u8`)).toBeNull();
    expect(resolveMediaUrl(BASE, "")).toBeNull();
    expect(resolveMediaUrl(BASE, "   ")).toBeNull();
    expect(resolveMediaUrl(BASE, undefined)).toBeNull();
    expect(resolveMediaUrl(BASE, { key: `${PREFIX}/master.m3u8` })).toBeNull();
  });

  it("leaves an absolute key alone, in case the API starts sending URLs", () => {
    expect(
      resolveMediaUrl(BASE, "https://cdn.example.net/abc/master.m3u8"),
    ).toBe("https://cdn.example.net/abc/master.m3u8");
    expect(resolveMediaUrl(undefined, "http://cdn.example.net/a.m3u8")).toBe(
      "http://cdn.example.net/a.m3u8",
    );
  });
});

describe("sourceTitle", () => {
  it("returns the reported title, trimmed", () => {
    expect(sourceTitle({ title: "  Hello  " })).toBe("Hello");
  });

  it("returns null for anything that is not a non-empty string", () => {
    expect(sourceTitle({})).toBeNull();
    expect(sourceTitle({ title: "" })).toBeNull();
    expect(sourceTitle({ title: "   " })).toBeNull();
    expect(sourceTitle({ title: 42 })).toBeNull();
  });
});

describe("levelsUrl", () => {
  it("swaps the manifest for levels.json in the same folder", () => {
    expect(levelsUrl(`${BASE}/${PREFIX}/master.m3u8`)).toBe(
      `${BASE}/${PREFIX}/levels.json`,
    );
  });

  it("only replaces the last segment", () => {
    expect(levelsUrl(`${BASE}/master.m3u8/${PREFIX}/master.m3u8`)).toBe(
      `${BASE}/master.m3u8/${PREFIX}/levels.json`,
    );
  });

  it("keeps a query string or fragment", () => {
    expect(levelsUrl(`${BASE}/${PREFIX}/master.m3u8?sig=abc`)).toBe(
      `${BASE}/${PREFIX}/levels.json?sig=abc`,
    );
    expect(levelsUrl(`${BASE}/${PREFIX}/master.m3u8#t`)).toBe(
      `${BASE}/${PREFIX}/levels.json#t`,
    );
  });

  it("uses the folder whatever the manifest is called", () => {
    expect(levelsUrl(`${BASE}/${PREFIX}/index.m3u8`)).toBe(
      `${BASE}/${PREFIX}/levels.json`,
    );
  });
});

describe("projectMedia", () => {
  it("resolves every artefact of an hls result", () => {
    expect(projectMedia(hlsSource, BASE)).toEqual({
      title: hlsSource.title,
      playlist: `${BASE}/${PREFIX}/master.m3u8`,
      poster: `${BASE}/${PREFIX}/thumbnail.jpg`,
      thumbnails: `${BASE}/${PREFIX}/storyboard.vtt`,
      captions: `${BASE}/${PREFIX}/captions.vtt`,
      chapters: `${BASE}/${PREFIX}/chapters.vtt`,
      levels: `${BASE}/${PREFIX}/levels.json`,
    });
  });

  it("returns null until the base is configured", () => {
    expect(projectMedia(hlsSource, undefined)).toBeNull();
  });

  it("returns null for a result kind this app cannot play", () => {
    expect(projectMedia({ ...hlsSource, type: "mp4" }, BASE)).toBeNull();
    expect(projectMedia({ playlist: `${PREFIX}/master.m3u8` }, BASE)).toBeNull();
  });

  it("returns null when the manifest is missing", () => {
    const withoutPlaylist: Record<string, unknown> = { ...hlsSource };
    delete withoutPlaylist.playlist;
    expect(projectMedia(withoutPlaylist, BASE)).toBeNull();
  });

  it("keeps artefacts that are missing out of the result", () => {
    expect(
      projectMedia(
        {
          type: "hls",
          title: "Done",
          playlist: `${PREFIX}/master.m3u8`,
          captions: `${PREFIX}/captions.vtt`,
          poster: "",
        },
        BASE,
      ),
    ).toEqual({
      title: "Done",
      playlist: `${BASE}/${PREFIX}/master.m3u8`,
      captions: `${BASE}/${PREFIX}/captions.vtt`,
      levels: `${BASE}/${PREFIX}/levels.json`,
    });
  });

  it("drops an empty title but keeps a real one trimmed", () => {
    expect(
      projectMedia({ ...hlsSource, title: "   " }, BASE)?.title,
    ).toBeNull();
    expect(
      projectMedia({ ...hlsSource, title: "  Hello  " }, BASE)?.title,
    ).toBe("Hello");
    expect(
      projectMedia({ ...hlsSource, title: { nested: true } }, BASE)?.title,
    ).toBeNull();
  });
});
