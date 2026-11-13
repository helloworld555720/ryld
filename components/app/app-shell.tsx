"use client";

import { Menu } from "lucide-react";
import { useState } from "react";

import { AppSidebar } from "@/components/app/app-sidebar";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  type SidebarPreference,
  serialiseSidebarPreference,
} from "@/lib/ui-prefs";
import { cn } from "@/lib/utils";

export interface AppShellProps {
  email: string;
  name?: string;
  /** Read from the preference cookie on the server, so the rail never flickers. */
  defaultSidebarPreference: SidebarPreference;
  children: React.ReactNode;
}

export function AppShell({
  email,
  name,
  defaultSidebarPreference,
  children,
}: AppShellProps) {
  const [preference, setPreference] = useState<SidebarPreference>(
    defaultSidebarPreference,
  );
  const [mobileOpen, setMobileOpen] = useState(false);

  const collapsed = preference === "rail";

  function toggleCollapsed() {
    const next: SidebarPreference = collapsed ? "expanded" : "rail";
    setPreference(next);
    // Persisted for the *next* request so the server renders the same width.
    document.cookie = serialiseSidebarPreference(
      next,
      window.location.protocol === "https:",
    );
  }

  return (
    <div className="bg-background flex min-h-dvh">
      <aside
        // Sticky, full-height rail. The width transition is the collapse.
        className={cn(
          "border-sidebar-border bg-sidebar sticky top-0 hidden h-dvh shrink-0 overflow-hidden border-r transition-[width] duration-200 ease-out md:block",
          collapsed ? "w-16" : "w-64",
        )}
        data-collapsed={collapsed}
      >
        <AppSidebar
          email={email}
          name={name}
          collapsed={collapsed}
          onToggleCollapse={toggleCollapsed}
        />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-border bg-background/80 sticky top-0 z-20 flex h-14 items-center gap-2 border-b px-4 backdrop-blur md:hidden">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation"
          >
            <Menu />
          </Button>
          <span className="text-sm font-semibold tracking-tight">Ryld</span>
        </header>

        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 md:px-8 md:py-10">
          {children}
        </main>
      </div>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent
          side="left"
          className="border-sidebar-border bg-sidebar w-72 gap-0 p-0 data-[side=left]:w-72"
        >
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SheetDescription className="sr-only">
            Main navigation and account menu.
          </SheetDescription>
          <AppSidebar
            email={email}
            name={name}
            onNavigate={() => setMobileOpen(false)}
          />
        </SheetContent>
      </Sheet>
    </div>
  );
}
