import * as Sentry from "@sentry/nextjs";
import { sentryOptions } from "./lib/sentry";

// Browser errors and page-load traces.
Sentry.init(sentryOptions);

// Traces App Router navigations too.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
