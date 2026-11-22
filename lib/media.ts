/**
 * Where a project's output actually lives.
 *
 * The API reports artefact **keys** in `source`, relative to the destination
 * (`79b7ea43…/master.m3u8`), not URLs, and neither the project nor the API
 * exposes the bucket or CDN in front of them. `MEDIA_BASE_URL` is that host;
 * this module is the one place that joins the two, so the player, the card and
 * the tests agree on how.
 *
 * Client-safe: it takes the base as an argument instead of reading env.
 */

export interface ProjectMedia {
  /** The video's own title, when the source reports one. */
  title: string | null;
  /** The HLS manifest, always present — a result without one is not playable. */
  playlist: string;
  poster?: string;
  thumbnails?: string;
  captions?: string;
  chapters?: string;
}

/**
 * Joins a stored key onto the base, single slash between them.
 *
 * Returns `null` when there is nothing to build: no base configured, or an empty
 * key. That is how callers tell "not configured" apart from a result that is
 * genuinely missing an artefact. An already-absolute key wins over the base, so
 * if the API ever starts emitting URLs they still play.
 */
export function resolveMediaUrl(
  base: string | undefined,
  key: unknown,
): string | null {
  if (typeof key !== "string") return null;

  const value = key.trim();
  if (value === "") return null;

  if (/^https?:\/\//i.test(value)) return value;
  if (!base) return null;

  return `${base.replace(/\/+$/, "")}/${value.replace(/^\/+/, "")}`;
}

/** The video's own title, if the result reports one. */
export function sourceTitle(
  source: Readonly<Record<string, unknown>>,
): string | null {
  return typeof source.title === "string" && source.title.trim() !== ""
    ? source.title.trim()
    : null;
}

function optionalField(
  base: string | undefined,
  source: Readonly<Record<string, unknown>>,
  name: string,
): string | undefined {
  return resolveMediaUrl(base, source[name]) ?? undefined;
}

/**
 * The playable media a `source` describes, or `null` when it is not something
 * this app can play: an unknown result kind, no manifest, or no base to resolve
 * the manifest against.
 */
export function projectMedia(
  source: Readonly<Record<string, unknown>>,
  base: string | undefined,
): ProjectMedia | null {
  if (source.type !== "hls") return null;

  const playlist = resolveMediaUrl(base, source.playlist);
  if (!playlist) return null;

  return {
    title: sourceTitle(source),
    playlist,
    poster: optionalField(base, source, "poster"),
    thumbnails: optionalField(base, source, "thumbnails"),
    captions: optionalField(base, source, "captions"),
    chapters: optionalField(base, source, "chapters"),
  };
}
