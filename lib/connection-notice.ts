import {
  CONNECTION_PROVIDERS,
  getConnectionProvider,
} from "@/lib/connections";

export interface ConnectionNotice {
  tone: "success" | "error";
  message: string;
}

/**
 * Turns the callback's status flags into display copy. Both values come from
 * the URL (or a popup message), so they are attacker-controllable: nothing is
 * echoed. Every message is derived from the provider registry or a fixed
 * string, and an unknown error falls back to generic copy.
 */
export function connectionNotice({
  connected,
  error,
}: {
  connected?: string;
  error?: string;
}): ConnectionNotice | null {
  const provider = connected ? getConnectionProvider(connected) : undefined;
  if (provider) {
    return { tone: "success", message: `${provider.label} is connected.` };
  }

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
      message:
        "Your session expired before authorization finished. Please try again.",
    };
  }

  for (const provider of CONNECTION_PROVIDERS) {
    if (
      error === `${provider.id}_failed` ||
      error === `${provider.id}_start_failed`
    ) {
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
