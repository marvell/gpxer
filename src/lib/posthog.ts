import type { PostHogConfig } from "posthog-js";
import posthog from "posthog-js";
import { config } from "@/config";

export function initPostHog(): boolean {
  const posthogKey = config.posthogKey.trim();
  if (posthogKey.length === 0) {
    return false;
  }

  const options: Partial<PostHogConfig> = {
    api_host: config.posthogHost,
    defaults: "2026-01-30",
  } as const;

  posthog.init(posthogKey, options);
  return true;
}
