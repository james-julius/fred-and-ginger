import { Suspense } from "react";
import { AppShell } from "@/components/shell/app-shell";

export default function Home() {
  // AppShell reads ?place= from the URL, which needs a Suspense boundary on a static page.
  return (
    <Suspense>
      <AppShell />
    </Suspense>
  );
}
