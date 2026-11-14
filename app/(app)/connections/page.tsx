import { CircleCheck, TriangleAlert } from "lucide-react";

import { ConnectionCard } from "@/components/app/connection-card";
import { ConnectionTabs } from "@/components/app/connection-tabs";
import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { listConnections } from "@/lib/api/connections";
import type { Connection } from "@/lib/api/schemas/connections";
import {
  CONNECTION_PROVIDERS,
  countAccountsByCategory,
  getConnectionProvider,
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

interface Notice {
  tone: "success" | "error";
  message: string;
}

function firstValue(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/**
 * The callback lands here with `?connected=<id>` or `?error=<code>`. Both are
 * attacker-controllable query values, so nothing is ever echoed: every message
 * is derived from the provider registry or a fixed string.
 */
function readNotice(params: ConnectionsSearchParams): Notice | null {
  const connected = getConnectionProvider(firstValue(params.connected) ?? "");
  if (connected) {
    return { tone: "success", message: `${connected.label} is connected.` };
  }

  const error = firstValue(params.error);
  if (!error) return null;

  if (error === "access_denied") {
    return {
      tone: "error",
      message: "Authorization was cancelled. Nothing was changed.",
    };
  }

  if (error === "session_expired") {
    return {
      tone: "error",
      message: "Your session expired before authorization finished. Please try again.",
    };
  }

  for (const provider of CONNECTION_PROVIDERS) {
    if (error === `${provider.id}_failed` || error === `${provider.id}_start_failed`) {
      return {
        tone: "error",
        message: `We couldn't finish connecting ${provider.label}. Please try again.`,
      };
    }
  }

  return {
    tone: "error",
    message: "We couldn't finish that connection. Please try again.",
  };
}

function NoticeBanner({ notice }: { notice: Notice }) {
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

  const notice = readNotice(params);

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

        {visible.length === 0 ? (
          <EmptyState
            icon={category.icon}
            title="Nothing here yet"
            description={`${category.label} connections aren't available yet. They'll appear here once Ryld supports them.`}
          />
        ) : (
          <div className="grid items-start gap-4 lg:grid-cols-2">
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
