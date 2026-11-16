import type { Metadata } from "next";

import { OAuthComplete } from "@/components/app/oauth-complete";

export const instant = false;

export const metadata: Metadata = {
  title: "Finishing connection",
  robots: { index: false, follow: false },
};

export default function ConnectionCompletePage() {
  return (
    <main className="grid min-h-svh place-items-center px-6">
      <OAuthComplete />
    </main>
  );
}
