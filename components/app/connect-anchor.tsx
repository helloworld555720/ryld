"use client";

import type { MouseEvent, ReactNode } from "react";

import {
  OAUTH_POPUP_COOKIE,
  OAUTH_POPUP_TTL_SECONDS,
  OAUTH_POPUP_WINDOW,
} from "@/lib/oauth-popup";

export interface ConnectAnchorProps {
  href: string;
  /** Accessible name; the visible label lives in `children`. */
  label: string;
  children: ReactNode;
}

function cookieSuffix(): string {
  return window.location.protocol === "https:" ? "; Secure" : "";
}

function readCookie(name: string): string | null {
  const prefix = `${name}=`;
  for (const part of document.cookie.split(";")) {
    const entry = part.trim();
    if (entry.startsWith(prefix)) {
      return decodeURIComponent(entry.slice(prefix.length));
    }
  }
  return null;
}

/**
 * The marker value is per-flow so a stale close-poll from an older popup can
 * never clear a marker that a newer flow just set.
 */
function setPopupMarker(): string {
  const value = crypto.randomUUID();
  document.cookie = `${OAUTH_POPUP_COOKIE}=${value}; Path=/; Max-Age=${OAUTH_POPUP_TTL_SECONDS}; SameSite=Lax${cookieSuffix()}`;
  return value;
}

function clearPopupMarker(value: string): void {
  if (readCookie(OAUTH_POPUP_COOKIE) !== value) return;
  document.cookie = `${OAUTH_POPUP_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax${cookieSuffix()}`;
}

/** A sensible centred window, not the full viewport. */
function popupFeatures(): string {
  const width = 520;
  const height = 680;
  const left = Math.round(
    window.screenX + Math.max(0, (window.outerWidth - width) / 2),
  );
  const top = Math.round(
    window.screenY + Math.max(0, (window.outerHeight - height) / 2),
  );

  return `popup=yes,width=${width},height=${height},left=${left},top=${top}`;
}

/**
 * The Connect control stays a real anchor: without JavaScript, or with a
 * modifier/middle click, it is the original full-page OAuth navigation. A plain
 * left click is upgraded to a popup.
 *
 * The marker cookie must be set *before* `window.open`, because the popup is
 * redirected straight to the provider and never runs our JavaScript.
 */
export function ConnectAnchor({ href, label, children }: ConnectAnchorProps) {
  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }

    event.preventDefault();
    const marker = setPopupMarker();

    const popup = window.open(href, OAUTH_POPUP_WINDOW, popupFeatures());

    if (!popup || popup.closed) {
      // Popup blocked: keep the flow working with the original full-page
      // redirect, and drop the marker so the callback is not misrouted.
      clearPopupMarker(marker);
      window.open(href, "_self");
      return;
    }

    /*
     * Safety net for a popup the user closes without finishing: clear the
     * marker so a later normal connect is not mistaken for a popup. The
     * callback clears it on every completed flow anyway.
     */
    const poll = window.setInterval(() => {
      if (!popup.closed) return;
      window.clearInterval(poll);
      clearPopupMarker(marker);
    }, 1_000);

    window.setTimeout(
      () => window.clearInterval(poll),
      OAUTH_POPUP_TTL_SECONDS * 1_000,
    );
  }

  return (
    <a href={href} aria-label={label} onClick={handleClick}>
      {children}
    </a>
  );
}
