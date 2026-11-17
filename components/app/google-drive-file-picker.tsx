"use client";

import { FolderOpen, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  gdriveAccessTokenSchema,
  gdriveConfigSchema,
} from "@/lib/api/schemas/connections";

/**
 * Google Drive file chooser.
 *
 * The Picker is a Google-hosted dialog: it needs an API key, the Cloud project
 * number (sent as `appId`) and a Google OAuth token with the `drive.file`
 * scope. Only the token is sensitive; it is fetched from the BFF for one
 * connection immediately before the Picker opens, kept in this function's
 * local scope, and never logged, stored or put in a URL.
 *
 * The script is appended dynamically, so CSP `strict-dynamic` trusts it the
 * same way it trusts our own bundles; no `script-src` host was added.
 *
 * Docs: https://developers.google.com/workspace/drive/picker/guides/web-picker
 */

const PICKER_SCRIPT = "https://apis.google.com/js/api.js";
const CONFIG_PATH = "/api/backend/connections/gdrive/config";
const TOKEN_PATH = "/api/backend/connections/gdrive/access-token";

/** The surface of `google.picker` this component uses. */
interface PickerView {
  setMode(mode: string): PickerView;
}

interface PickerBuilder {
  addView(view: PickerView): PickerBuilder;
  setOAuthToken(token: string): PickerBuilder;
  setDeveloperKey(key: string): PickerBuilder;
  setAppId(appId: string): PickerBuilder;
  setCallback(callback: (data: Record<string, unknown>) => void): PickerBuilder;
  build(): { setVisible(visible: boolean): void };
}

interface PickerNamespace {
  PickerBuilder: new () => PickerBuilder;
  DocsView: new (viewId?: string) => PickerView;
  ViewId: { DOCS: string };
  DocsViewMode: { LIST: string };
  Response: { ACTION: string; DOCUMENTS: string };
  Document: { ID: string; NAME: string };
  Action: { PICKED: string };
}

interface GapiNamespace {
  load(libraries: string, onReady: () => void, onError?: () => void): void;
}

declare global {
  interface Window {
    gapi?: GapiNamespace;
    google?: { picker?: PickerNamespace };
  }
}

let pickerLibrary: Promise<PickerNamespace> | null = null;

/** Loads `api.js` once per page, then the Picker bundle. */
function loadPicker(): Promise<PickerNamespace> {
  if (pickerLibrary) return pickerLibrary;

  pickerLibrary = new Promise<PickerNamespace>((resolve, reject) => {
    const ready = () => {
      const picker = window.google?.picker;
      if (picker) resolve(picker);
      else reject(new Error("picker missing after load"));
    };

    const bootstrap = () => {
      const gapi = window.gapi;
      if (!gapi) {
        reject(new Error("gapi missing after load"));
        return;
      }
      gapi.load("picker", ready, () => reject(new Error("picker load failed")));
    };

    if (window.gapi) {
      bootstrap();
      return;
    }

    const script = document.createElement("script");
    script.src = PICKER_SCRIPT;
    script.async = true;
    script.addEventListener("load", bootstrap);
    script.addEventListener("error", () =>
      reject(new Error("api.js failed to load")),
    );
    document.head.appendChild(script);
  }).catch((error: unknown) => {
    // A network blip should not poison the page: the next click retries.
    pickerLibrary = null;
    throw error;
  });

  return pickerLibrary;
}

async function fetchJson(
  path: string,
  init?: RequestInit,
): Promise<unknown> {
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      accept: "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) throw new Error(`request failed with ${response.status}`);
  return response.json().catch(() => null);
}

/** The token and keys a Picker open needs, all fetched per open. */
async function pickerCredentials(
  connId: string,
): Promise<{ apiKey: string; appId: string; accessToken: string }> {
  const [configPayload, tokenPayload] = await Promise.all([
    fetchJson(CONFIG_PATH),
    fetchJson(TOKEN_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ conn_id: connId }),
    }),
  ]);

  const config = gdriveConfigSchema.safeParse(configPayload);
  const token = gdriveAccessTokenSchema.safeParse(tokenPayload);

  if (!config.success || !token.success) {
    throw new Error("unexpected credentials shape");
  }

  return {
    apiKey: config.data.api_key,
    appId: config.data.project_number,
    accessToken: token.data.access_token,
  };
}

export interface GoogleDriveFilePickerProps {
  id: string;
  /** Connected account to read from; empty means none is connected. */
  accountId: string;
  /** Current `file_id`, owned by the form. */
  fileId: string;
  /** Display name of the current file, if one was picked here. */
  fileName: string;
  disabled: boolean;
  onPick: (file: { id: string; name: string }) => void;
}

export function GoogleDriveFilePicker({
  id,
  accountId,
  fileId,
  fileName,
  disabled,
  onPick,
}: GoogleDriveFilePickerProps) {
  const [busy, setBusy] = useState(false);

  if (!accountId) {
    return (
      <p className="text-muted-foreground text-sm">
        Connect a Google Drive account before choosing a file.
      </p>
    );
  }

  async function openPicker() {
    setBusy(true);

    try {
      const [picker, credentials] = await Promise.all([
        loadPicker(),
        pickerCredentials(accountId),
      ]);

      const view = new picker.DocsView(picker.ViewId.DOCS).setMode(
        picker.DocsViewMode.LIST,
      );

      const dialog = new picker.PickerBuilder()
        .addView(view)
        .setOAuthToken(credentials.accessToken)
        .setDeveloperKey(credentials.apiKey)
        .setAppId(credentials.appId)
        .setCallback((data) => {
          setBusy(false);

          if (data[picker.Response.ACTION] !== picker.Action.PICKED) return;

          const documents = data[picker.Response.DOCUMENTS];
          const document = Array.isArray(documents)
            ? (documents[0] as Record<string, unknown> | undefined)
            : undefined;

          const pickedId = document?.[picker.Document.ID];
          const pickedName = document?.[picker.Document.NAME];

          if (typeof pickedId !== "string" || pickedId.length === 0) return;

          onPick({
            id: pickedId,
            name: typeof pickedName === "string" ? pickedName : "",
          });
        })
        .build();

      dialog.setVisible(true);
    } catch {
      setBusy(false);
      toast.error("We couldn't open Google Drive. Please try again.");
    }
  }

  const selected = fileName || fileId;

  return (
    <div className="space-y-2">
      <Button
        id={id}
        type="button"
        variant="outline"
        size="sm"
        onClick={openPicker}
        disabled={disabled || busy}
      >
        {busy ? (
          <Loader2 className="animate-spin" aria-hidden="true" />
        ) : (
          <FolderOpen aria-hidden="true" />
        )}
        {busy ? "Opening…" : selected ? "Choose another file" : "Choose file"}
      </Button>

      <p className="text-muted-foreground truncate text-xs" aria-live="polite">
        {selected ? `Selected: ${selected}` : "No file selected."}
      </p>
    </div>
  );
}
