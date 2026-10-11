import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// No incremental cache yet: every page is either static or per-user. Add R2 here if we start using ISR.
export default defineCloudflareConfig({});
