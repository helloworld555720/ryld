/**
 * Constants for the popup OAuth handshake, shared by the browser and the BFF.
 *
 * The provider only ever redirects to the single registered `redirect_uri`, so
 * the callback cannot learn "I am running inside a popup" from the URL without
 * breaking that registration. The connect anchor sets this short-lived cookie
 * immediately before opening the popup; the callback reads it, redirects to the
 * completion page instead of `/connections`, and clears it.
 */
export const OAUTH_POPUP_COOKIE = "ryld_oauth_popup";
export const OAUTH_POPUP_TTL_SECONDS = 600;
export const OAUTH_POPUP_WINDOW = "ryld-oauth";

/** `postMessage` channel from the completion page to the opener. */
export const OAUTH_POPUP_MESSAGE = "ryld:oauth";

export interface OAuthPopupMessage {
  type: typeof OAUTH_POPUP_MESSAGE;
  /** Provider id on success, validated by the opener against the registry. */
  connected?: string;
  /** Error slug on failure, mapped to fixed copy by the opener. */
  error?: string;
}
