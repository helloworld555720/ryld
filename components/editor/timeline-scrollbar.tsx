"use client";

import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";

import { cn } from "@/lib/utils";

/** The thumb never gets narrower than this, so it stays grabbable at deep zoom. */
const MIN_THUMB_WIDTH = 28;

/** Keyboard nudge: a tenth of the viewport, or this much, whichever is larger. */
const KEY_PAN_MIN_PX = 64;

interface DragState {
  pointerId: number;
  startX: number;
  /** Scroll position when the drag began. */
  startScroll: number;
  /** Pixels the thumb can travel; the scale between pointer and scroll. */
  travel: number;
}

export interface TimelineScrollbarProps {
  scrollX: number;
  /** The furthest the lane can scroll; zero hides the bar. */
  maxScroll: number;
  viewportWidth: number;
  onScroll: (scrollX: number) => void;
  onManual: () => void;
  className?: string;
}

/**
 * The timeline's horizontal scrollbar.
 *
 * The lane itself does not scroll natively — `scrollX` in `useTimeline` is the
 * only scroll — so this bar is the visible counterpart of that state: its thumb
 * is proportional to the visible fraction and dragging it pans the view. It is
 * only mounted when the sequence is wider than the viewport.
 */
export function TimelineScrollbar({
  scrollX,
  maxScroll,
  viewportWidth,
  onScroll,
  onManual,
  className,
}: TimelineScrollbarProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const thumbDrag = useRef<DragState | null>(null);
  const trackDrag = useRef<DragState | null>(null);
  const [trackWidth, setTrackWidth] = useState(0);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;

    const observer = new ResizeObserver(() => {
      setTrackWidth(track.clientWidth);
    });
    observer.observe(track);

    return () => observer.disconnect();
  }, []);

  if (!(maxScroll > 0) || !(viewportWidth > 0)) return null;

  const contentWidth = viewportWidth + maxScroll;
  const thumbWidth =
    trackWidth > 0
      ? Math.min(
          trackWidth,
          Math.max(
            MIN_THUMB_WIDTH,
            (viewportWidth / contentWidth) * trackWidth,
          ),
        )
      : 0;
  const travel = Math.max(1, trackWidth - thumbWidth);
  const thumbLeft =
    maxScroll > 0 ? (Math.min(maxScroll, Math.max(0, scrollX)) / maxScroll) * travel : 0;

  const beginThumbDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    onManual();
    thumbDrag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startScroll: scrollX,
      travel,
    };
  };

  const moveThumbDrag = (event: PointerEvent<HTMLDivElement>) => {
    const drag = thumbDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    const delta = event.clientX - drag.startX;
    onScroll(drag.startScroll + (delta / drag.travel) * maxScroll);
  };

  const endThumbDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (thumbDrag.current?.pointerId !== event.pointerId) return;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    thumbDrag.current = null;
  };

  const beginTrackDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);

    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const left = Math.min(Math.max(0, x - thumbWidth / 2), travel);
    const target = (left / travel) * maxScroll;

    onManual();
    onScroll(target);

    trackDrag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startScroll: target,
      travel,
    };
  };

  const moveTrackDrag = (event: PointerEvent<HTMLDivElement>) => {
    const drag = trackDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    const delta = event.clientX - drag.startX;
    onScroll(drag.startScroll + (delta / drag.travel) * maxScroll);
  };

  const endTrackDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (trackDrag.current?.pointerId !== event.pointerId) return;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    trackDrag.current = null;
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = Math.max(KEY_PAN_MIN_PX, viewportWidth * 0.1);

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      onManual();
      onScroll(scrollX - step);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      onManual();
      onScroll(scrollX + step);
    } else if (event.key === "Home") {
      event.preventDefault();
      onManual();
      onScroll(0);
    } else if (event.key === "End") {
      event.preventDefault();
      onManual();
      onScroll(maxScroll);
    }
  };

  return (
    <div
      className={cn(
        "bg-card/40 flex h-3 shrink-0 items-center border-t px-2",
        className,
      )}
    >
      <div
        ref={trackRef}
        role="scrollbar"
        aria-controls="timeline-lane"
        aria-orientation="horizontal"
        aria-valuemin={0}
        aria-valuemax={Math.round(maxScroll)}
        aria-valuenow={Math.round(Math.min(maxScroll, Math.max(0, scrollX)))}
        aria-label="Timeline scroll"
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onPointerDown={beginTrackDrag}
        onPointerMove={moveTrackDrag}
        onPointerUp={endTrackDrag}
        onPointerCancel={endTrackDrag}
        className="bg-border/70 relative h-1.5 w-full cursor-pointer touch-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div
          onPointerDown={beginThumbDrag}
          onPointerMove={moveThumbDrag}
          onPointerUp={endThumbDrag}
          onPointerCancel={endThumbDrag}
          className="bg-muted-foreground/60 hover:bg-muted-foreground absolute top-0 h-full cursor-grab touch-none rounded-full active:cursor-grabbing"
          style={{ left: thumbLeft, width: thumbWidth }}
        />
      </div>
    </div>
  );
}
