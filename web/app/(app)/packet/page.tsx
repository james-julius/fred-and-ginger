import type { Metadata } from "next";
import { PacketPage } from "@/components/packet/packet-page";

export const metadata: Metadata = { title: "Application packet · Fred" };

export default function Packet() {
  return <PacketPage />;
}
