/**
 * Content-Security-Policy construction. Pure functions so the policy can be
 * unit-tested without booting Next.
 *
 * See node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md
 */

export interface CspOptions {
  nonce: string;
  isDev: boolean;
}

/**
 * 122 bits of crypto randomness (`crypto.randomUUID()` is a v4 UUID), base64.
 * A nonce only needs to be unguessable for the lifetime of one response, so
 * this is ample; the important property is that it is never reused.
 */
export function newNonce(): string {
  return Buffer.from(crypto.randomUUID()).toString("base64");
}

export function buildCsp({ nonce, isDev }: CspOptions): string {
  const directives = [
    "default-src 'self'",

    // Scripts: only our bundles plus inline scripts that carry this request's
    // nonce. `strict-dynamic` lets those trusted scripts load their own chunks,
    // which is what the Next runtime does. No 'unsafe-inline' — ever.
    // Dev needs 'unsafe-eval' for React's debugging (stack reconstruction).
    [
      "script-src 'self'",
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
      isDev ? "'unsafe-eval'" : null,
    ]
      .filter(Boolean)
      .join(" "),

    // Styles: inline styles are required. Radix/shadcn set `style` attributes
    // for positioning (dropdowns, sheets, tooltips), and CSP nonces do not
    // cover style *attributes* — only <style> elements. A nonce here would
    // therefore break the UI. Style injection is a far weaker XSS vector than
    // script injection, which stays nonce-locked above.
    "style-src 'self' 'unsafe-inline'",

    "img-src 'self' blob: data:",
    "font-src 'self' data:",
    // The browser only ever talks to this origin (auth proxy + BFF). Dev needs
    // the HMR websocket.
    `connect-src 'self'${isDev ? " ws: wss:" : ""}`,

    // The Google Picker dialog renders in an iframe hosted on docs.google.com.
    // Nothing else may be framed; the Picker script itself is loaded through a
    // dynamically created <script>, which `strict-dynamic` trusts.
    "frame-src https://docs.google.com",

    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "worker-src 'self' blob:",
    "manifest-src 'self'",

    // Only meaningful over HTTPS; dev runs on plain http://localhost.
    isDev ? null : "upgrade-insecure-requests",
  ];

  return directives.filter(Boolean).join("; ");
}
