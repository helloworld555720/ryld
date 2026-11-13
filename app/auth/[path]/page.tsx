import { viewPaths } from "@better-auth-ui/core";
import { notFound } from "next/navigation";

import { Auth } from "@/components/auth/auth";

const validAuthPaths = new Set<string>(Object.values(viewPaths.auth));

/**
 * Auth pages read `params` and the session, so they can't be prerendered.
 * Blocking is correct here: the sign-in form must not flash a stale state.
 */
export const instant = false;

export default async function AuthPage({
  params,
}: {
  params: Promise<{ path: string }>;
}) {
  const { path } = await params;

  if (!validAuthPaths.has(path)) notFound();

  return (
    <main className="flex min-h-dvh items-center justify-center p-4 md:p-6">
      <Auth path={path} />
    </main>
  );
}
