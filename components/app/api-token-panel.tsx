"use client";

import {
  Check,
  ClipboardCopy,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface TokenResponse {
  token: string;
  expiresAt: string | null;
}

function isTokenResponse(value: unknown): value is TokenResponse {
  if (typeof value !== "object" || value === null) return false;

  const candidate = value as { token?: unknown; expiresAt?: unknown };
  return (
    typeof candidate.token === "string" &&
    candidate.token.length > 0 &&
    (candidate.expiresAt === null || typeof candidate.expiresAt === "string")
  );
}

/** Fixed width: the mask must not leak the token's length. */
const MASK = "•".repeat(48);

function expiryCopy(expiresAt: string | null, now: number): string {
  if (!expiresAt) {
    return "Expiry unavailable. Generate a new token if this one stops working.";
  }

  const expiresMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiresMs)) {
    return "Expiry unavailable. Generate a new token if this one stops working.";
  }

  const remainingMs = expiresMs - now;
  if (remainingMs <= 0) return "This token has expired. Generate a new one.";

  const minutes = Math.max(1, Math.ceil(remainingMs / 60_000));
  return `Expires in about ${minutes} minute${minutes === 1 ? "" : "s"}.`;
}

export function ApiTokenPanel() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // Keep the "expires in …" label honest without a re-render every second.
  useEffect(() => {
    if (!expiresAt) return;
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, [expiresAt]);

  async function generate() {
    setPending(true);
    setCopied(false);

    try {
      const response = await fetch("/api/token", {
        method: "POST",
        headers: { accept: "application/json" },
        credentials: "same-origin",
        cache: "no-store",
      });

      if (response.status === 401) {
        router.push("/auth/sign-in?redirectTo=%2Fapi-token");
        return;
      }

      if (!response.ok) {
        toast.error("Could not create a token. Please try again.");
        return;
      }

      const data: unknown = await response.json();
      if (!isTokenResponse(data)) {
        toast.error("Could not create a token. Please try again.");
        return;
      }

      setToken(data.token);
      setExpiresAt(data.expiresAt);
      setRevealed(false);
      setNow(Date.now());
    } catch {
      toast.error(
        "Could not reach the server. Check your connection and try again.",
      );
    } finally {
      setPending(false);
    }
  }

  async function copy() {
    if (!token) return;

    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
      toast.success("Token copied to the clipboard.");
    } catch {
      toast.error("Copy failed. Reveal the token and copy it manually.");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound
            className="text-muted-foreground size-4"
            aria-hidden="true"
          />
          Personal API token
        </CardTitle>
        <CardDescription>
          A bearer token for calling the Ryld API from a terminal or API client.
          It is minted for you and expires after about 15 minutes.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {token ? (
          <>
            <div className="border-border bg-muted/40 rounded-lg border p-3">
              <p className="text-muted-foreground mb-2 text-[0.68rem] font-medium tracking-[0.12em] uppercase">
                Token
              </p>
              <code className="block max-h-32 overflow-y-auto font-mono text-xs break-all select-all">
                {revealed ? token : MASK}
              </code>
            </div>

            <p role="status" className="text-muted-foreground text-xs">
              {expiryCopy(expiresAt, now)}
            </p>

            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={() => void copy()} disabled={pending}>
                {copied ? (
                  <Check aria-hidden="true" />
                ) : (
                  <ClipboardCopy aria-hidden="true" />
                )}
                {copied ? "Copied" : "Copy token"}
              </Button>

              <Button
                type="button"
                variant="outline"
                onClick={() => setRevealed((value) => !value)}
                disabled={pending}
              >
                {revealed ? (
                  <EyeOff aria-hidden="true" />
                ) : (
                  <Eye aria-hidden="true" />
                )}
                {revealed ? "Hide" : "Reveal"}
              </Button>

              <Button
                type="button"
                variant="ghost"
                onClick={() => void generate()}
                disabled={pending}
              >
                {pending ? (
                  <Loader2 className="animate-spin" aria-hidden="true" />
                ) : (
                  <RefreshCw aria-hidden="true" />
                )}
                Regenerate
              </Button>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-start gap-3">
            <p className="text-muted-foreground max-w-prose text-sm">
              No token has been generated in this session. Tokens are not stored
              anywhere; reloading this page discards the one shown here.
            </p>
            <Button
              type="button"
              onClick={() => void generate()}
              disabled={pending}
            >
              {pending ? (
                <Loader2 className="animate-spin" aria-hidden="true" />
              ) : (
                <KeyRound aria-hidden="true" />
              )}
              {pending ? "Generating…" : "Generate token"}
            </Button>
          </div>
        )}
      </CardContent>

      <CardFooter className="text-muted-foreground gap-2 text-xs">
        <ShieldAlert className="size-3.5 shrink-0" aria-hidden="true" />
        Treat it like a password. Anyone holding it can act as you until it
        expires.
      </CardFooter>
    </Card>
  );
}
