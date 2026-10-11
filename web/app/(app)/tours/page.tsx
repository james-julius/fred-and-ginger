import type { Metadata } from "next";
import { ToursPage } from "@/components/tours/tours-page";

export const metadata: Metadata = { title: "Tours · Fred" };

export default function Tours() {
  return <ToursPage />;
}
