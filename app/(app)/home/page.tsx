import { ArrowUpRight, Cable, Radio } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getSession } from "@/lib/auth/server";

export const instant = false;

export default async function HomePage() {
  const session = await getSession();
  const firstName = session?.user.name?.trim().split(/\s+/)[0];
  const email = session?.user.email ?? "your account";

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Overview"
        title={firstName ? `Welcome back, ${firstName}` : "Welcome back"}
        description="A quick look at your workspace and the services linked to it."
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/connections">
              Open connections
              <ArrowUpRight aria-hidden="true" />
            </Link>
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardDescription>Connections</CardDescription>
            <CardTitle className="text-2xl font-semibold tabular-nums">
              0
            </CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground flex items-center gap-2 text-sm">
            <Cable className="size-4 shrink-0" aria-hidden="true" />
            No services linked yet.
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardDescription>Account</CardDescription>
            <CardTitle className="truncate text-base">{email}</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center gap-2">
            <Badge variant="secondary">Signed in</Badge>
            <span className="text-muted-foreground text-xs">
              Session verified by the auth service.
            </span>
          </CardContent>
        </Card>
      </div>

      <section className="space-y-3" aria-labelledby="recent-activity">
        <div className="flex items-baseline justify-between gap-4">
          <h2
            id="recent-activity"
            className="text-sm font-semibold tracking-tight"
          >
            Recent activity
          </h2>
          <span className="text-muted-foreground text-xs">Last 7 days</span>
        </div>
        <EmptyState
          icon={Radio}
          title="Nothing to show yet"
          description="Activity from your connected services will appear here once the API is wired up."
        />
      </section>
    </div>
  );
}
