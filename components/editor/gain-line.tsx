"use client";

import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";

import {
  GAIN_LINE_PADDING,
  GAIN_MAX_DB,
  GAIN_MIN_DB,
  clampGainDb,
  formatGainDb,
  fractionFromGain,
  gainFromFraction,
} from "@/lib/audio";
import { cn } from "@/lib/utils";

const EDGE_PADDING = GAIN_LINE_PADDING;

const STEP_DB = 1;
const COARSE_STEP_DB = 6;

export interface GainLineProps {
  /** The current loudness in dB. */
  gainDb: number;
  onChange: (gainDb: number) => void;
  /** Names the control for assistive tech, e.g. "Clip loudness". */
  label: string;
  /** A muted track keeps its line but reads as inactive. */
  muted?: boolean;
  /** Show the dB readout all the time, not only while hovered or dragged. */
  alwaysShowReadout?: boolean;
}

/**
 * A horizontal loudness line to drag up (louder) or down (quieter).
 *
 * It fills the positioned parent that holds it, and the parent decides how tall
 * that is, so the same control sits over a clip's waveform or across an empty
 * track row. The line follows the pointer exactly: where it was grabbed is
 * remembered so it does not jump to the cursor. Everything it handles stops at
 * the line, because it lives inside a clip that otherwise starts a reorder on
 * any press.
 *
 * While dragging, the line is drawn from its own state, so it keeps up with the
 * pointer however fast the pointer reports. The edit itself is passed on at most
 * once per animation frame: each one re-renders the timeline and redraws the
 * waveform, and doing that at a pointer's polling rate only makes it stutter.
 */
export function GainLine({
  gainDb,
  onChange,
  label,
  muted = false,
  alwaysShowReadout = false,
}: GainLineProps) {
  const areaRef = useRef<HTMLDivElement | null>(null);
  const grabRef = useRef<{ pointerId: number; offsetY: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  /** The level under the pointer mid-drag; `null` means use the prop. */
  const [live, setLive] = useState<number | null>(null);

  const onChangeRef = useRef(onChange);
  const pendingRef = useRef<number | null>(null);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    onChangeRef.current = onChange;
  });

  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  /** Hands the newest pending level to the editor, now. */
  const flush = () => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }

    const pending = pendingRef.current;
    pendingRef.current = null;
    if (pending !== null) onChangeRef.current(pending);
  };

  /** Queues a level; only the latest one in a frame is applied. */
  const schedule = (value: number) => {
    pendingRef.current = value;
    if (frameRef.current !== null) return;

    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      flush();
    });
  };

  const level = live ?? clampGainDb(gainDb);
  const fraction = fractionFromGain(level);

  /* Pixel position of the line inside the area, measured from the top. */
  const lineTop = (area: DOMRect, value: number) =>
    EDGE_PADDING + (1 - fractionFromGain(value)) * (area.height - EDGE_PADDING * 2);

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (event.button !== 0) return;

    const area = areaRef.current?.getBoundingClientRect();
    if (!area) return;

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.focus({ preventScroll: true });

    grabRef.current = {
      pointerId: event.pointerId,
      offsetY: event.clientY - area.top - lineTop(area, level),
    };
    setDragging(true);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    event.stopPropagation();

    const grab = grabRef.current;
    const area = areaRef.current?.getBoundingClientRect();
    if (!grab || grab.pointerId !== event.pointerId || !area) return;

    const travel = area.height - EDGE_PADDING * 2;
    if (travel <= 0) return;

    const top = event.clientY - area.top - grab.offsetY - EDGE_PADDING;
    const next = gainFromFraction(1 - top / travel);

    setLive(next);
    schedule(next);
  };

  /** Ends a drag from any route (release, cancel, lost capture). Idempotent. */
  const endDrag = () => {
    if (!grabRef.current) return;

    grabRef.current = null;
    flush();
    setDragging(false);
    setLive(null);
  };

  const finishDrag = (event: PointerEvent<HTMLDivElement>) => {
    event.stopPropagation();

    const grab = grabRef.current;
    if (!grab || grab.pointerId !== event.pointerId) return;

    endDrag();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Tab") return;

    /* The clip behind this control deletes on Delete and reorders on the
     * arrows; none of that is meant for a focused loudness line. */
    event.stopPropagation();

    const step = event.shiftKey ? COARSE_STEP_DB : STEP_DB;
    let next: number | null = null;

    switch (event.key) {
      case "ArrowUp":
      case "ArrowRight":
        next = level + step;
        break;
      case "ArrowDown":
      case "ArrowLeft":
        next = level - step;
        break;
      case "PageUp":
        next = level + COARSE_STEP_DB;
        break;
      case "PageDown":
        next = level - COARSE_STEP_DB;
        break;
      case "Home":
        next = GAIN_MIN_DB;
        break;
      case "End":
        next = GAIN_MAX_DB;
        break;
      case "0":
        next = 0;
        break;
      default:
        return;
    }

    event.preventDefault();
    const clamped = clampGainDb(next);
    if (clamped !== level) onChange(clamped);
  };

  const readout = formatGainDb(level);

  return (
    <div
      ref={areaRef}
      className="pointer-events-none absolute inset-0"
      data-dragging={dragging ? "true" : undefined}
    >
      <div
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-orientation="vertical"
        aria-valuemin={GAIN_MIN_DB}
        aria-valuemax={GAIN_MAX_DB}
        aria-valuenow={Math.round(level * 10) / 10}
        aria-valuetext={readout}
        title={`${label}: ${readout}. Drag up or down. Double-click to reset.`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
        onLostPointerCapture={endDrag}
        onDoubleClick={(event) => {
          event.stopPropagation();
          onChange(0);
        }}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={handleKeyDown}
        className={cn(
          "group pointer-events-auto absolute inset-x-0 flex h-3 -translate-y-1/2 cursor-ns-resize touch-none items-center outline-none",
        )}
        style={{
          top: `calc(${EDGE_PADDING}px + ${1 - fraction} * (100% - ${EDGE_PADDING * 2}px))`,
        }}
      >
        <span
          className={cn(
            "pointer-events-none block h-px w-full bg-white shadow-[0_0_0_0.5px_rgba(0,0,0,0.45)] transition-opacity",
            muted ? "opacity-30" : dragging ? "opacity-100" : "opacity-70",
            "group-hover:opacity-100 group-focus-visible:opacity-100",
          )}
        />
        <span
          className={cn(
            "pointer-events-none absolute right-1 -translate-y-px rounded-sm bg-black/70 px-1 py-px font-mono text-[10px] leading-none text-white tabular-nums transition-opacity",
            alwaysShowReadout || dragging
              ? "opacity-100"
              : "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100",
          )}
          style={{ bottom: fraction > 0.5 ? undefined : "0.5rem", top: fraction > 0.5 ? "0.5rem" : undefined }}
        >
          {readout}
        </span>
      </div>
    </div>
  );
}
