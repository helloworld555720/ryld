"use client";

import { useEffect, useMemo, useState } from "react";

import type { EditorClip } from "@/lib/editor";
import {
  WAVEFORM_BAR_WIDTH,
  parseAudioLevels,
  waveformBars,
  waveformPath,
  type AudioLevels,
} from "@/lib/waveform";

interface AudioLevelsState {
  /** The URL the levels belong to, so a new project never shows old audio. */
  url: string | undefined;
  levels: AudioLevels | null;
}

/**
 * Loads and validates a project's `levels.json` once.
 *
 * The fetch is best-effort, like the storyboard: a media host without CORS
 * headers, a missing file, a malformed body or a slow response leaves the levels
 * `null`, and the clips simply show a flat line. Nothing about the editor
 * depends on it succeeding.
 */
export function useAudioLevels(url: string | undefined): AudioLevels | null {
  const [state, setState] = useState<AudioLevelsState>({
    url: undefined,
    levels: null,
  });

  useEffect(() => {
    if (!url) return;

    const controller = new AbortController();
    let active = true;

    void (async () => {
      try {
        const response = await fetch(url, {
          signal: controller.signal,
          credentials: "omit",
          cache: "force-cache",
        });
        if (!response.ok) return;

        const body: unknown = await response.json();
        if (!active) return;

        setState({ url, levels: parseAudioLevels(body) });
      } catch {
        /* Best-effort: the flat line remains the fallback. */
      }
    })();

    return () => {
      active = false;
      controller.abort();
    };
  }, [url]);

  return state.url === url ? state.levels : null;
}

export interface ClipWaveformProps {
  clip: EditorClip;
  levels: AudioLevels | null;
  pxPerSecond: number;
  /** The clip's left edge in lane pixels, after scrolling. */
  clipLeftPx: number;
  viewportWidth: number;
  /** Height of the waveform strip in pixels. */
  height: number;
  /** A muted track keeps its waveform but reads as inactive. */
  muted?: boolean;
}

/**
 * The audio waveform for one clip.
 *
 * Only bars that intersect the viewport are computed, and they are drawn as one
 * SVG path, so a four-minute clip at frame zoom does not create thousands of
 * nodes. Without levels it draws a single centre line, which also keeps the
 * strip from collapsing while the file loads.
 */
export function ClipWaveform({
  clip,
  levels,
  pxPerSecond,
  clipLeftPx,
  viewportWidth,
  height,
  muted = false,
}: ClipWaveformProps) {
  const path = useMemo(() => {
    if (!levels) return "";

    return waveformPath(
      waveformBars({
        levels,
        clip,
        pxPerSecond,
        clipLeftPx,
        viewportWidth,
      }),
      height,
      WAVEFORM_BAR_WIDTH,
    );
  }, [levels, clip, pxPerSecond, clipLeftPx, viewportWidth, height]);

  return (
    <svg
      className="text-primary pointer-events-none absolute inset-x-0 bottom-0 w-full overflow-visible"
      style={{ height, opacity: muted ? 0.3 : 0.75 }}
      aria-hidden="true"
      focusable="false"
    >
      <line
        x1="0"
        x2="100%"
        y1={height / 2}
        y2={height / 2}
        stroke="currentColor"
        strokeOpacity={0.35}
      />
      {path ? <path d={path} fill="currentColor" /> : null}
    </svg>
  );
}
