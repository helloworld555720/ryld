"use client";

import { useEffect, type RefObject } from "react";

import { dbToLinear } from "@/lib/audio";

interface GainGraph {
  context: AudioContext;
  gain: GainNode;
}

/**
 * One graph per media element, kept outside React: a media element can be
 * wired into Web Audio only once, so a remount (or hot reload) must find the
 * graph it already made. `null` records a failed attempt so it is not retried.
 */
const graphs = new WeakMap<HTMLMediaElement, GainGraph | null>();

/**
 * Routes the element through a gain node. Once this succeeds the element's
 * sound comes *only* from the graph, which is why it is created lazily: a plain
 * `volume` is enough (and has no CORS or autoplay risk) until a clip is boosted
 * past 0 dB, which a media element cannot do on its own.
 */
function graphFor(video: HTMLMediaElement): GainGraph | null {
  const known = graphs.get(video);
  if (known !== undefined) return known;

  let graph: GainGraph | null = null;

  try {
    const context = new AudioContext();
    const source = context.createMediaElementSource(video);
    const gain = context.createGain();
    source.connect(gain);
    gain.connect(context.destination);

    /* Browsers start a context suspended until the page has been interacted
     * with, and a suspended context is silence. Playing is such a moment. */
    video.addEventListener("play", () => {
      if (context.state === "suspended") void context.resume().catch(() => {});
    });
    if (context.state === "suspended") void context.resume().catch(() => {});

    graph = { context, gain };
  } catch {
    /* No Web Audio, or the element is already wired elsewhere: fall back to
     * the plain volume, which tops out at 0 dB. */
    graph = null;
  }

  graphs.set(video, graph);
  return graph;
}

/**
 * Applies a loudness in dB to the preview's `<video>`.
 *
 * Attenuation uses the element's own `volume`. A boost needs a gain node, so
 * the graph is built the first time one is asked for and used for every level
 * after that. Mute is a separate `muted` prop on the element and still wins.
 */
export function usePreviewGain(
  videoRef: RefObject<HTMLVideoElement | null>,
  gainDb: number,
): void {
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const linear = dbToLinear(gainDb);
    const graph = linear > 1 || graphs.get(video) ? graphFor(video) : null;

    if (!graph) {
      video.volume = Math.min(linear, 1);
      return;
    }

    video.volume = 1;
    /* A short ramp: a hard step in gain is audible as a click. */
    graph.gain.gain.setTargetAtTime(linear, graph.context.currentTime, 0.01);
  }, [videoRef, gainDb]);
}
