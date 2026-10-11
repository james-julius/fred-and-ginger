// Types for .open-next/worker.js (wrangler alias "open-next-worker"), which only exists after
// `opennextjs-cloudflare build`, so the type-check doesn't depend on a build.
declare module "open-next-worker" {
  const handler: ExportedHandler<Record<string, unknown>>;
  export default handler;
  export const DOQueueHandler: unknown;
  export const DOShardedTagCache: unknown;
  export const BucketCachePurge: unknown;
}
