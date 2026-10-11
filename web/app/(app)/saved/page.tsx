import type { Metadata } from "next";
import { Suspense } from "react";
import { InboxPage } from "@/components/shell/inbox-page";

export const metadata: Metadata = { title: "Saved · Fred" };

export default function Saved() {
  // InboxPage reads ?place= from the URL, which needs a Suspense boundary on a static page.
  return (
    <Suspense>
      <InboxPage list="saved" />
    </Suspense>
  );
}
