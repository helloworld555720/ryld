/** Public configuration. Safe to import from client components. */
export interface PublicEnv {
  appName: string;
}

export function getPublicEnv(): PublicEnv {
  return {
    // Must be referenced literally so Next can inline it at build time.
    appName: process.env.NEXT_PUBLIC_APP_NAME?.trim() || "Ryld",
  };
}

export const publicEnv = getPublicEnv();
