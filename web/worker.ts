// The Worker entry: OpenNext's generated Worker, wrapped with Sentry. This is the server side of
// Sentry for the app (errors and traces from rendering and routes); instrumentation-client.ts is
// the browser side. Run `opennextjs-cloudflare build` first: it writes .open-next/worker.js.
import { withSentry } from "@sentry/nextjs/cloudflare";
import handler from "./.open-next/worker.js";
import { sentryOptions } from "./lib/sentry";

// OpenNext's Durable Object classes, re-exported in case its caching is turned on later
export { DOQueueHandler, DOShardedTagCache, BucketCachePurge } from "./.open-next/worker.js";

export default withSentry(() => sentryOptions, handler);
