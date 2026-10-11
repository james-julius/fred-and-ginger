"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

// Shown when the root layout itself crashes; reports the error to Sentry.
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: 32 }}>
        <h1 style={{ fontSize: 20, fontWeight: 600 }}>Something went wrong</h1>
        <p>Fred hit a problem loading the app. Reload the page to try again.</p>
      </body>
    </html>
  );
}
