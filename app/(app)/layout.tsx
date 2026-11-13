import { cookies } from "next/headers";
import { connection } from "next/server";

import { AppShell } from "@/components/app/app-shell";
import { requireSession } from "@/lib/auth/server";
import { SIDEBAR_COOKIE, readSidebarPreference } from "@/lib/ui-prefs";

/**
 * Deliberately blocks on the server so an anonymous visitor never sees the
 * authenticated shell. This is the documented opt-out for the auth guard:
 * see node_modules/next/dist/docs/.../authentication-with-cache-components.md
 * ("Set export const instant = false ... to let it keep blocking").
 */
export const instant = false;

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  /*
   * Mark this segment request-time before anything renders. The shell imports
   * better-auth's client, whose store reads `Date.now()`; under cacheComponents
   * that is an "unstable value" if the subtree is ever prerendered, and dev
   * reports it as a blocking-prerender error. Everything here is session-gated
   * anyway, so rendering per request is the correct behaviour, not a workaround.
   */
  await connection();

  const session = await requireSession();
  const cookieStore = await cookies();

  return (
    <AppShell
      email={session.user.email}
      name={session.user.name}
      // Read on the server so the first paint already has the right width.
      defaultSidebarPreference={readSidebarPreference(
        cookieStore.get(SIDEBAR_COOKIE)?.value,
      )}
    >
      {children}
    </AppShell>
  );
}
