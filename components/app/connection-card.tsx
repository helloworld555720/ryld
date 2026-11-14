import { Plus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { Connection } from "@/lib/api/schemas/connections";
import type { ConnectionProvider } from "@/lib/connections";
import { cn } from "@/lib/utils";

/**
 * One provider with every account attached to it.
 *
 * The API exposes only `{ id, type }` per connection — no channel name, avatar
 * or scope — so an account is labelled with a short prefix of its connection
 * id. That is the honest label until upstream returns account metadata; the
 * id keeps two accounts of the same provider distinguishable.
 */
export interface ConnectionCardProps {
  provider: ConnectionProvider;
  accounts: readonly Connection[];
}

/** First UUID segment: stable, readable, and copyable for support. */
function shortId(id: string): string {
  return id.slice(0, 8);
}

function monogram(id: string): string {
  return id.slice(0, 2).toUpperCase();
}

/** Rows shown before the list scrolls. Keeps every card the same height. */
const VISIBLE_ACCOUNTS = 2;

export function ConnectionCard({ provider, accounts }: ConnectionCardProps) {
  const Icon = provider.icon;
  const count = accounts.length;
  const isConnected = count > 0;
  const isScrollable = count > VISIBLE_ACCOUNTS;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start gap-3">
          <span className="bg-muted text-foreground grid size-10 shrink-0 place-items-center rounded-lg">
            <Icon className="size-5" aria-hidden="true" />
          </span>
          <div className="space-y-1">
            <CardTitle>{provider.label}</CardTitle>
            {/*
             * Fixed two lines: descriptions differ in length, and a card that
             * wraps to three lines would be taller than its neighbours.
             */}
            <CardDescription className="line-clamp-2 min-h-10">
              {provider.description}
            </CardDescription>
          </div>
        </div>

        <CardAction>
          <Badge variant="outline" className="text-muted-foreground">
            {isConnected
              ? `${count} connected`
              : "Not connected"}
          </Badge>
        </CardAction>
      </CardHeader>

      {/*
       * The account band is a fixed height in both states. A provider with no
       * accounts gets the same two-row band with a placeholder, so every card
       * in a row is the same height whether or not something is connected.
       * Above two accounts the list scrolls inside the card; it is focusable
       * whenever it scrolls, because a region that only responds to the mouse
       * fails WCAG 2.1.1.
       */}
      <CardContent className="px-0">
        {isConnected ? (
          <ul
            tabIndex={isScrollable ? 0 : undefined}
            aria-label={`${provider.label} accounts`}
            className={cn(
              "border-border/70 divide-border/70 divide-y border-y h-[6.25rem]",
              isScrollable &&
                "focus-visible:ring-ring overflow-y-auto overscroll-contain focus-visible:ring-2 focus-visible:outline-none",
            )}
          >
            {accounts.map((account) => (
              <li
                key={account.id}
                className="flex items-center justify-between gap-3 px-(--card-spacing) py-2.5"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    aria-hidden="true"
                    className="bg-muted text-muted-foreground grid size-7 shrink-0 place-items-center rounded-full text-[0.6rem] font-semibold uppercase"
                  >
                    {monogram(account.id)}
                  </span>
                  <p className="truncate text-xs font-medium">
                    Account {shortId(account.id)}
                  </p>
                </div>

                <Badge variant="outline" className="text-muted-foreground gap-1.5">
                  <span
                    className="bg-foreground size-1.5 rounded-full"
                    aria-hidden="true"
                  />
                  Connected
                </Badge>
              </li>
            ))}
          </ul>
        ) : (
          <div className="border-border/70 flex h-[6.25rem] items-center justify-center border-y px-(--card-spacing)">
            <p className="text-muted-foreground text-xs">
              No accounts connected
            </p>
          </div>
        )}
      </CardContent>

      {/*
       * `items-start` on the grid keeps each card at its content height: the
       * number of accounts is user data, and stretching a two-account card to
       * match a six-account sibling would leave a large dead region inside it.
       * `mt-auto` still pins the footer if a card is ever stretched.
       */}
      <CardFooter className="mt-auto justify-between gap-3">
        {/*
         * One line, always: the button width differs between states, and a
         * wrapping label would make connected cards taller than unconnected
         * ones. Truncation is the guard; the copy is short enough not to need it.
         */}
        <span className="text-muted-foreground min-w-0 truncate text-xs">
          {isConnected
            ? `Via ${provider.consentHost}`
            : `Opens ${provider.consentHost}`}
        </span>

        <Button
          asChild
          size="sm"
          variant={isConnected ? "outline" : "default"}
        >
          {/*
           * Plain anchor, not next/link: this is a route handler that answers
           * with a 303 to the provider, so the browser must perform a real
           * navigation.
           */}
          <a
            href={`/api/backend/connections/${provider.id}/start`}
            aria-label={
              isConnected
                ? `Add another ${provider.label} account`
                : `Connect ${provider.label}`
            }
          >
            {isConnected ? (
              <>
                <Plus className="size-3.5" aria-hidden="true" />
                Add another account
              </>
            ) : (
              "Connect"
            )}
          </a>
        </Button>
      </CardFooter>
    </Card>
  );
}
