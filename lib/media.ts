import type { Project } from "@/lib/api/schemas/projects";
import { projectStatusLabel } from "@/lib/projects";

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
  /** Audio peak levels for the timeline waveform, next to the manifest. */
  levels: string;
}

/**
 * The audio levels file that sits beside a playlist: `<folder>/master.m3u8`
 * becomes `<folder>/levels.json`.
 *
 * Only the final path segment is replaced, so a query string survives and a
 * folder that happens to contain `master.m3u8` is left alone. A playlist with a
 * different name is replaced the same way, because the file's location is the
 * folder, not the manifest's name.
 */
export function levelsUrl(playlist: string): string {
  return playlist.replace(/[^/?#]*(?=[?#]|$)/, "levels.json");
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
    levels: levelsUrl(playlist),
  };
}

/**
 * Why there is no playable result, in the caller's terms.
 *
 * Shared by the project page and the editor so both explain the same state the
 * same way. Every branch says what the project is doing and what would make a
 * video appear, rather than leaving a dead `<video>` for the viewer to press.
 */
export function playbackNotice(
  project: Project,
  mediaBase: string | undefined,
): string {
  const status = project.status.toLowerCase();

  if (status === "draft") {
    return "This project is a draft. Submit it to start processing; the video appears here when it finishes.";
  }

  if (status === "pending" || status === "queued" || status === "processing") {
    return `This project is ${projectStatusLabel(project.status).toLowerCase()}. Reload the page to check again; the video appears here when processing finishes.`;
  }

  if (status === "failed") {
    return "Processing failed, so there is no video to play. The details below are everything the API recorded.";
  }

  if (!project.source) {
    return "This project finished without a result to play.";
  }

  if (project.source.type !== "hls") {
    return "This result isn't a video this app can play.";
  }

  if (!mediaBase) {
    /*
     * The API reports storage keys, never URLs, so playback needs the host in
     * front of the bucket. Saying so beats a silent failure inside the player.
     */
    return "The media host isn't configured, so the generated files can't be loaded yet. Set MEDIA_BASE_URL to the bucket or CDN in front of this project's output.";
  }

  return "This result has no playlist, so there is nothing to play.";
}
