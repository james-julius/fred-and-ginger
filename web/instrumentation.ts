import * as Sentry from "@sentry/nextjs";

// Server errors from server components, route handlers and middleware. Sentry itself is started by
// the Worker entry (worker.ts), so nothing to register here.
export const onRequestError = Sentry.captureRequestError;
