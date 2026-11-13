import { Plus } from "lucide-react";

import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CONNECTION_PROVIDERS } from "@/lib/connections";

export const instant = false;

export default function ConnectionsPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Workspace"
        title="Connections"
        description="Link the services Ryld works with. Each one is authorized on the provider's own site."
      />

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
                    href={`/api/backend/connect/${provider.id}`}
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
