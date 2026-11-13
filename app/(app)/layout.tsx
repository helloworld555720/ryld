import { cookies } from "next/headers";

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
