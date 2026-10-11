// Sentry options shared by the browser, server and edge setups. The DSN is public by design (it
// only lets you send events). Same Sentry project as the API Worker; app: "web" tells them apart.
// No session replay: it would record chat text and addresses.
export const sentryOptions = {
  dsn: "https://0fd1958443b60c3f28c4bf8979296f38@o4504868195729408.ingest.us.sentry.io/4512239160590336",
  environment: process.env.NODE_ENV === "production" ? "production" : "development",
  initialScope: { tags: { app: "web" } },
  tracesSampleRate: 1.0,
  // keep the session cookie, request headers and bodies (chat messages, codes) out of events
  dataCollection: { cookies: false, httpHeaders: false, httpBodies: [] },
};
