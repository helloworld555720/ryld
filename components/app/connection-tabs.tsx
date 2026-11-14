import Link from "next/link";

import {
  CONNECTION_CATEGORIES,
  type ConnectionCategoryId,
} from "@/lib/connections";
import { cn } from "@/lib/utils";

/**
 * Category filter for `/connections`.
 *
 * Plain links, not client state: the tab lives in the URL so the page stays
 * server-rendered and a category is shareable. Unknown `?tab=` values never
 * reach this component — the page resolves them against the registry first.
 */
export interface ConnectionTabsProps {
  active: ConnectionCategoryId;
  /** Connected accounts per category, shown as a count when non-zero. */
  counts: Record<ConnectionCategoryId, number>;
}

/** The default category keeps a clean `/connections` URL. */
function hrefFor(id: ConnectionCategoryId): string {
  return id === CONNECTION_CATEGORIES[0].id
    ? "/connections"
    : `/connections?tab=${id}`;
}

export function ConnectionTabs({ active, counts }: ConnectionTabsProps) {
  return (
    <nav
      aria-label="Connection categories"
      className="border-border bg-card/60 inline-flex items-center gap-1 rounded-lg border p-1"
    >
      {CONNECTION_CATEGORIES.map((category) => {
        const isActive = category.id === active;
        const count = counts[category.id] ?? 0;

        return (
          <Link
            key={category.id}
            href={hrefFor(category.id)}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "focus-visible:ring-ring inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium transition-colors outline-none focus-visible:ring-2",
              isActive
                ? "bg-secondary text-foreground shadow-xs ring-1 ring-foreground/10"
                : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
            )}
          >
            {category.label}
            {count > 0 ? (
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.5 text-[0.65rem] leading-none font-semibold tabular-nums",
                  isActive
                    ? "bg-foreground/10 text-foreground"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {count}
                <span className="sr-only">
                  {" "}
                  connected {count === 1 ? "account" : "accounts"}
                </span>
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
