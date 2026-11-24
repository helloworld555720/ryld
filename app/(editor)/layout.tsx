import { connection } from "next/server";

import { requireSession } from "@/lib/auth/server";

/**
 * The editor is a full-window surface, so it gets its own layout instead of the
 * dashboard shell: no sidebar, no page padding, no page scroll — the timeline
 * owns the bottom of the viewport.
 *
 * Same guard as `(app)/layout.tsx`: the proxy's cookie check is only an
 * optimisation, so the server validates the session here and blocks before any
 * editor markup is rendered.
 */
export const instant = false;

export default async function EditorLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  await connection();
  await requireSession();

  return (
    <div className="bg-background h-dvh overflow-hidden">{children}</div>
  );
}
