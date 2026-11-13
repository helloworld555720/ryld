import Link from "next/link";

import { requireSession } from "@/lib/auth/server";

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

  return (
    <div className="bg-background min-h-dvh">
      <header className="border-border flex items-center justify-between border-b px-4 py-3 md:px-6">
        <span className="text-sm font-medium tracking-tight">Ryld</span>
        <div className="flex items-center gap-3">
          <span className="text-muted-foreground hidden text-sm sm:inline">
            {session.user.email}
          </span>
          <Link
            className="text-sm underline underline-offset-4"
            href="/auth/sign-out"
          >
            Sign out
          </Link>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl p-4 md:p-6">{children}</main>
    </div>
  );
}
