import { requireSession } from "@/lib/auth/server";

export const instant = false;

export default async function DashboardPage() {
  const session = await requireSession();

  return (
    <div className="space-y-2">
      <h1 className="text-xl font-semibold tracking-tight">Dashboard</h1>
      <p className="text-muted-foreground text-sm">
        Signed in as {session.user.email}.
      </p>
      <p className="text-muted-foreground text-sm">
        Auth proxy and server-side session guard are live. Feature work starts
        here.
      </p>
    </div>
  );
}
