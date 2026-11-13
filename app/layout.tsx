import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { connection } from "next/server";

import { Providers } from "@/components/providers";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

/**
 * Allow the request-time render forced by `connection()` below. Next 16 requires
 * this explicit opt-in for a route that blocks instead of streaming a shell.
 */
export const instant = false;

export const metadata: Metadata = {
  title: {
    default: "Ryld",
    template: "%s · Ryld",
  },
  description: "Internal tool",
  robots: { index: false, follow: false },
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  /*
   * CSP nonces are applied during server-side rendering from the request's
   * Content-Security-Policy header (set in proxy.ts). A prerendered shell is
   * built when no request exists, so its scripts would carry no nonce and a
   * strict script-src would block the app.
   *
   * Forcing a request-time render is therefore required for the nonce policy.
   * Everything user-facing here is behind the session guard and already
   * dynamic, so the cost is limited to the two static routes (`/` redirect,
   * 404). See: docs/01-app/02-guides/content-security-policy.md ("How nonces
   * work in Next.js").
   *
   * `instant = false` is the documented way to let a route block on request
   * data under cacheComponents (`[block]` in the build error
   * "blocking-prerender-dynamic"). Without it the build fails for `/`.
   */
  await connection();

  return (
    <html lang="en" className={cn("dark", "font-sans", geist.variable)}>
      <body className="bg-background text-foreground min-h-dvh antialiased">
        <Providers>
          <TooltipProvider>{children}</TooltipProvider>
        </Providers>
      </body>
    </html>
  );
}
