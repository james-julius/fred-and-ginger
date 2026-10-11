import type { Metadata } from "next";
import { Suspense } from "react";
import { InboxPage } from "@/components/shell/inbox-page";

export const metadata: Metadata = { title: "Passed · Fred" };

export default function Passed() {
  // InboxPage reads ?place= from the URL, which needs a Suspense boundary on a static page.
  return (
    <Suspense>
      <InboxPage list="passed" />
    </Suspense>
  );
}
