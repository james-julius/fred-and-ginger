import type { Metadata } from "next";
import { ProfilePage } from "@/components/profile/profile-page";

export const metadata: Metadata = { title: "Profile · Fred" };

export default function Profile() {
  return <ProfilePage />;
}
