export type Config = {
  posthogKey: string;
  posthogHost: string;
};

function env(getter: () => string | undefined, fallback: string = ""): string {
  try {
    return getter() ?? fallback;
  } catch {
    return fallback;
  }
}

export const config: Config = {
  posthogKey: env(() => process.env.BUN_PUBLIC_POSTHOG_KEY, ""),
  posthogHost: env(() => process.env.BUN_PUBLIC_POSTHOG_HOST, "https://eu.i.posthog.com"),
};
