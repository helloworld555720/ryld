import { CircleCheck, TriangleAlert } from "lucide-react";

import { ConnectionCard } from "@/components/app/connection-card";
import { ConnectionTabs } from "@/components/app/connection-tabs";
import { ConnectionsOAuthListener } from "@/components/app/connections-oauth-listener";
import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { listConnections } from "@/lib/api/connections";
import type { Connection } from "@/lib/api/schemas/connections";
import {
  connectionNotice,
  type ConnectionNotice,
} from "@/lib/connection-notice";
import {
  countAccountsByCategory,
  groupConnectionsByProvider,
  resolveConnectionCategory,
} from "@/lib/connections";
import { isApiError } from "@/lib/errors";
import { log } from "@/lib/log";

export const instant = false;

type ConnectionsSearchParams = Record<
  string,
  string | string[] | undefined
>;

function firstValue(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function NoticeBanner({ notice }: { notice: ConnectionNotice }) {
  const isSuccess = notice.tone === "success";
  const Icon = isSuccess ? CircleCheck : TriangleAlert;

  return (
    <div
      role={isSuccess ? "status" : "alert"}
      className="border-border bg-card text-foreground flex items-start gap-3 rounded-xl border px-4 py-3 text-sm"
    >
      <Icon
        className="text-muted-foreground mt-0.5 size-4 shrink-0"
        aria-hidden="true"
      />
      <p>{notice.message}</p>
    </div>
  );
}

async function readConnections(): Promise<Connection[]> {
  try {
    return await listConnections();
  } catch (error) {
    // The page is still usable without the list: every card can start a fresh
    // flow. Log the reason and render as "not connected".
    log("error", "connections.list_failed", {
      reason: isApiError(error) ? error.code : "UNKNOWN",
      status: isApiError(error) ? error.status : undefined,
    });
    return [];
  }
}

export default async function ConnectionsPage({
  searchParams,
}: {
  searchParams: Promise<ConnectionsSearchParams>;
}) {
  const [params, connections] = await Promise.all([
    searchParams,
    readConnections(),
  ]);

  const notice = connectionNotice({
    connected: firstValue(params.connected),
    error: firstValue(params.error),
  });

  // `?tab=` is a public URL parameter: resolve it against the registry so an
  // unknown value renders the default tab instead of an empty page.
  const category = resolveConnectionCategory(firstValue(params.tab));

  const groups = groupConnectionsByProvider(connections);
  const visible = groups.filter(
    (group) => group.provider.category === category.id,
  );
  const counts = countAccountsByCategory(connections);

  return (
    <div className="space-y-8">
      <ConnectionsOAuthListener />

      <PageHeader
        eyebrow="Workspace"
        title="Connections"
        description="Link the services Ryld works with. Each account is authorized on the provider's own site."
      />

      {notice ? <NoticeBanner notice={notice} /> : null}

      <section aria-label={`${category.label} connections`} className="space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <ConnectionTabs active={category.id} counts={counts} />
          <p className="text-muted-foreground text-xs">{category.description}</p>
        </div>

        {/*
         * TEMPORARY preview: three columns instead of two. Revert to
         * `grid items-start gap-4 lg:grid-cols-2` on request.
         */}
        {visible.length === 0 ? (
          <EmptyState
            icon={category.icon}
            title="Nothing here yet"
            description={`${category.label} connections aren't available yet. They'll appear here once Ryld supports them.`}
          />
        ) : (
          <div className="grid items-start gap-4 lg:grid-cols-3">
            {visible.map((group) => (
              <ConnectionCard
                key={group.provider.id}
                provider={group.provider}
                accounts={group.accounts}
              />
            ))}
          </div>
        )}
      </section>

      <p className="text-muted-foreground max-w-prose text-xs">
        You can revoke access at any time from the provider&rsquo;s account
        settings.
      </p>
    </div>
  );
}
