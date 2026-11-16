"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { toast } from "sonner";

import { connectionNotice } from "@/lib/connection-notice";
import {
  OAUTH_POPUP_MESSAGE,
  type OAuthPopupMessage,
} from "@/lib/oauth-popup";

function asSlug(value: unknown): string | undefined {
  return typeof value === "string" ? value.slice(0, 64) : undefined;
}

/**
 * Listens for the popup's completion message and refreshes the server-rendered
 * account list, so a newly connected account appears without a page reload.
 *
 * The message is same-origin only. Its values are still treated as untrusted:
 * `connectionNotice` maps them against the provider registry and never echoes
 * an unknown value.
 */
export function ConnectionsOAuthListener() {
  const router = useRouter();

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;

      const data = event.data as Partial<OAuthPopupMessage> | null;
      if (!data || data.type !== OAUTH_POPUP_MESSAGE) return;

      const notice = connectionNotice({
        connected: asSlug(data.connected),
        error: asSlug(data.error),
      });
      if (!notice) return;

      if (notice.tone === "success") toast.success(notice.message);
      else toast.error(notice.message);

      router.refresh();
    }

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [router]);

  return null;
}
