"use client";

import {
  ChevronsUpDown,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { authClient } from "@/lib/auth/client";
import { NAV_ITEMS } from "@/lib/nav";
import { cn } from "@/lib/utils";

export interface AppSidebarProps {
  /** Display only — `user.id` is the identity key everywhere else. */
  email: string;
  name?: string;
  /** Icon-rail mode. The mobile drawer always passes `false`. */
  collapsed?: boolean;
  /** Omitted in the mobile drawer, which has nothing to collapse. */
  onToggleCollapse?: () => void;
  /** Called after navigation so the mobile drawer can close itself. */
  onNavigate?: () => void;
}

function initialsOf(email: string, name?: string): string {
  const source = (name?.trim() || email.split("@")[0] || "").trim();
  if (!source) return "?";

  const parts = source.split(/[\s._-]+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}

export function AppSidebar({
  email,
  name,
  collapsed = false,
  onToggleCollapse,
  onNavigate,
}: AppSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchRef = useRef<HTMLInputElement>(null);

  const [query, setQuery] = useState("");
  const [signingOut, setSigningOut] = useState(false);

  const items = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return NAV_ITEMS;
    return NAV_ITEMS.filter((item) =>
      item.label.toLowerCase().includes(needle),
    );
  }, [query]);

  const isActive = useCallback(
    (href: string) => pathname === href || pathname.startsWith(`${href}/`),
    [pathname],
  );

  const expandAndFocusSearch = useCallback(() => {
    onToggleCollapse?.();
    // The input only exists after the rail has expanded.
    requestAnimationFrame(() => searchRef.current?.focus());
  }, [onToggleCollapse]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key.toLowerCase() !== "k") return;

      event.preventDefault();
      if (collapsed) {
        expandAndFocusSearch();
      } else {
        searchRef.current?.focus();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [collapsed, expandAndFocusSearch]);

  async function handleSignOut() {
    setSigningOut(true);
    const { error } = await authClient.signOut();

    if (error) {
      setSigningOut(false);
      toast.error("Could not sign you out. Please try again.");
      return;
    }

    // Drop the cached session server components read, then leave the shell.
    router.replace("/auth/sign-in");
    router.refresh();
  }

  return (
    <div className="bg-sidebar text-sidebar-foreground flex h-full flex-col">
      <div
        className={cn(
          "flex h-14 shrink-0 items-center gap-2 px-3",
          collapsed && "justify-center px-0",
        )}
      >
        <Link
          href="/home"
          onClick={onNavigate}
          className="focus-visible:ring-sidebar-ring flex min-w-0 items-center gap-2 rounded-md outline-none focus-visible:ring-2"
        >
          <span className="bg-sidebar-primary text-sidebar-primary-foreground grid size-7 shrink-0 place-items-center rounded-md text-sm font-semibold">
            R
          </span>
          {collapsed ? null : (
            <span className="truncate text-sm font-semibold tracking-tight">
              Ryld
            </span>
          )}
        </Link>
      </div>

      <div className={cn("px-2 pb-2", collapsed && "px-2")}>
        {collapsed ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Search navigation"
                onClick={expandAndFocusSearch}
                className="text-muted-foreground hover:text-sidebar-foreground mx-auto flex"
              >
                <Search />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">Search · Ctrl K</TooltipContent>
          </Tooltip>
        ) : (
          <div className="relative">
            <Search
              className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2"
              aria-hidden="true"
            />
            <Input
              ref={searchRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setQuery("");
              }}
              type="text"
              placeholder="Search"
              aria-label="Search navigation"
              autoComplete="off"
              className="border-sidebar-border bg-sidebar-accent/40 placeholder:text-muted-foreground h-8 pr-12 pl-8 text-xs focus-visible:border-sidebar-ring"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className="text-muted-foreground hover:text-sidebar-foreground absolute top-1/2 right-1.5 grid size-5 -translate-y-1/2 place-items-center rounded"
              >
                <X className="size-3.5" />
              </button>
            ) : (
              <kbd className="border-sidebar-border bg-sidebar text-muted-foreground pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 rounded border px-1 py-0.5 font-sans text-[0.6rem] leading-none">
                Ctrl K
              </kbd>
            )}
          </div>
        )}
      </div>

      <nav
        aria-label="Main"
        className="min-h-0 flex-1 overflow-y-auto px-2 py-1"
      >
        {collapsed ? null : (
          <p className="text-muted-foreground px-2 pb-1.5 text-[0.68rem] font-medium tracking-[0.12em] uppercase">
            Menu
          </p>
        )}

        <ul className="space-y-px">
          {items.map((item) => {
            const active = isActive(item.href);

            const link = (
              <Link
                href={item.href}
                onClick={() => {
                  // The sidebar survives navigation; a leftover filter would
                  // hide the destination the user just asked for.
                  setQuery("");
                  onNavigate?.();
                }}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "group focus-visible:ring-sidebar-ring flex h-8 items-center gap-2.5 rounded-md px-2 text-sm font-medium transition-colors outline-none focus-visible:ring-2",
                  "text-muted-foreground hover:bg-sidebar-accent/70 hover:text-sidebar-foreground",
                  active && "bg-sidebar-accent text-sidebar-foreground shadow-xs",
                  collapsed && "justify-center px-0",
                )}
              >
                <item.icon className="size-4 shrink-0" aria-hidden="true" />
                {collapsed ? null : (
                  <span className="truncate">{item.label}</span>
                )}
              </Link>
            );

            return (
              <li key={item.href}>
                {collapsed ? (
                  <Tooltip>
                    <TooltipTrigger asChild>{link}</TooltipTrigger>
                    <TooltipContent side="right">
                      {item.label}
                    </TooltipContent>
                  </Tooltip>
                ) : (
                  link
                )}
              </li>
            );
          })}
        </ul>

        {items.length === 0 && !collapsed ? (
          <p className="text-muted-foreground px-2 py-6 text-center text-xs">
            No matches for &ldquo;{query}&rdquo;.
          </p>
        ) : null}
      </nav>

      <div className="border-sidebar-border shrink-0 border-t p-2">
        <div
          className={cn(
            "flex items-center gap-1.5",
            collapsed && "flex-col gap-2",
          )}
        >
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Account menu"
                className={cn(
                  "hover:bg-sidebar-accent focus-visible:ring-sidebar-ring flex min-w-0 flex-1 items-center gap-2 rounded-md p-1.5 text-left transition-colors outline-none focus-visible:ring-2",
                  collapsed && "w-8 flex-none justify-center",
                )}
              >
                <Avatar size="sm" className="shrink-0">
                  <AvatarFallback className="bg-sidebar-accent text-sidebar-foreground text-[0.65rem] font-medium">
                    {initialsOf(email, name)}
                  </AvatarFallback>
                </Avatar>

                {collapsed ? null : (
                  <>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium">
                        {name || email}
                      </span>
                      {name ? (
                        <span className="text-muted-foreground block truncate text-[0.68rem]">
                          {email}
                        </span>
                      ) : null}
                    </span>
                    <ChevronsUpDown
                      className="text-muted-foreground size-3.5 shrink-0"
                      aria-hidden="true"
                    />
                  </>
                )}
              </button>
            </DropdownMenuTrigger>

            <DropdownMenuContent
              side={collapsed ? "right" : "top"}
              align={collapsed ? "start" : "end"}
              className="w-56"
            >
              <DropdownMenuLabel className="flex flex-col gap-0.5">
                <span className="truncate text-xs font-medium">
                  {name || email}
                </span>
                {name ? (
                  <span className="text-muted-foreground truncate text-xs font-normal">
                    {email}
                  </span>
                ) : null}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                disabled={signingOut}
                onSelect={(event) => {
                  event.preventDefault();
                  void handleSignOut();
                }}
              >
                <LogOut />
                {signingOut ? "Signing out…" : "Sign out"}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {onToggleCollapse ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={onToggleCollapse}
                  aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                  className="text-muted-foreground hover:text-sidebar-foreground shrink-0"
                >
                  {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
                </Button>
              </TooltipTrigger>
              <TooltipContent side={collapsed ? "right" : "top"}>
                {collapsed ? "Expand sidebar" : "Collapse sidebar"}
              </TooltipContent>
            </Tooltip>
          ) : null}
        </div>
      </div>
    </div>
  );
}
