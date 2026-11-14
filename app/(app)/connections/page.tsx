import { CircleCheck, Plus, TriangleAlert } from "lucide-react";

import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  CONNECTION_PROVIDERS,
  getConnectionProvider,
} from "@/lib/connections";

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

export default async function ConnectionsPage({
  searchParams,
}: {
  searchParams: Promise<ConnectionsSearchParams>;
}) {
  const notice = readNotice(await searchParams);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Workspace"
        title="Connections"
        description="Link the services Ryld works with. Each one is authorized on the provider's own site."
      />

      {notice ? <NoticeBanner notice={notice} /> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        {CONNECTION_PROVIDERS.map((provider) => {
          const Icon = provider.icon;

          return (
            <Card key={provider.id} className="justify-between">
              <CardHeader>
                <div className="flex items-start gap-3">
                  <span className="bg-muted text-foreground grid size-10 shrink-0 place-items-center rounded-lg">
                    <Icon className="size-5" aria-hidden="true" />
                  </span>
                  <div className="space-y-1">
                    <CardTitle>{provider.label}</CardTitle>
                    <CardDescription>{provider.description}</CardDescription>
                  </div>
                </div>
              </CardHeader>

              <CardFooter className="justify-between gap-3">
                <span className="text-muted-foreground text-xs">
                  Opens {provider.consentHost} to authorize
                </span>
                <Button asChild size="sm">
                  {/*
                   * Plain anchor, not next/link: this is a route handler that
                   * answers with a 303 to the provider, so the browser must
                   * perform a real navigation.
                   */}
                  <a
                    href={`/api/backend/connections/${provider.id}/start`}
                    aria-label={`Connect ${provider.label}`}
                  >
                    Connect
                  </a>
                </Button>
              </CardFooter>
            </Card>
          );
        })}

        <div className="border-border/80 flex flex-col items-center justify-center gap-1 rounded-xl border border-dashed px-6 py-10 text-center">
          <Plus className="text-muted-foreground mb-1 size-4" aria-hidden="true" />
          <p className="text-sm font-medium">More services soon</p>
          <p className="text-muted-foreground text-xs">
            Additional connections will appear here.
          </p>
        </div>
      </div>

      <p className="text-muted-foreground max-w-prose text-xs">
        You can revoke access at any time from the provider&rsquo;s account
        settings.
      </p>
    </div>
  );
}
