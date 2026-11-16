"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

import {
  OAUTH_POPUP_MESSAGE,
  type OAuthPopupMessage,
} from "@/lib/oauth-popup";

function asSlug(value: string | null): string | undefined {
  return value ? value.slice(0, 64) : undefined;
}

/**
 * Rendered inside the OAuth popup when the callback finishes. It reports the
 * outcome to the opener, then closes itself.
 *
 * If there is no opener — the user opened the callback as a tab, or the browser
 * severed it — the same status flags are handed to `/connections` through the
 * normal URL, so the server-rendered notice still works.
 */
export function OAuthComplete() {
  const router = useRouter();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = asSlug(params.get("connected"));
    const error = asSlug(params.get("error"));

    let opener: Window | null = null;
    try {
      opener = window.opener;
    } catch {
      opener = null;
    }

    if (opener && !opener.closed) {
      const message: OAuthPopupMessage = {
        type: OAUTH_POPUP_MESSAGE,
        ...(connected ? { connected } : {}),
        ...(error ? { error } : {}),
      };

      opener.postMessage(message, window.location.origin);
      window.close();

      // `window.close()` is allowed for script-opened windows, but if the
      // browser refuses, do not strand the user on a dead "Finishing…" page.
      window.setTimeout(() => {
        if (!window.closed) router.replace("/connections");
      }, 800);
      return;
    }

    const target = new URLSearchParams();
    if (connected) target.set("connected", connected);
    if (error) target.set("error", error);

    router.replace(`/connections${target.size ? `?${target.toString()}` : ""}`);
  }, [router]);

  return (
    <div className="space-y-3 text-center">
      <p className="text-sm font-medium">Finishing connection…</p>
      <p className="text-muted-foreground text-xs">
        This window closes automatically. If it does not, you can close it.
      </p>
      <Link
        href="/connections"
        className="text-muted-foreground text-xs underline underline-offset-4"
      >
        Back to Connections
      </Link>
    </div>
  );
}
