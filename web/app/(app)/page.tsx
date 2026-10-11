import { Suspense } from "react";
import { InboxPage } from "@/components/shell/inbox-page";

export default function Home() {
  // InboxPage reads ?place= from the URL, which needs a Suspense boundary on a static page.
  return (
    <Suspense>
      <InboxPage />
    </Suspense>
  );
}
