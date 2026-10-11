import Image from "next/image";
import type { S } from "@/lib/api/client";

/** Your photo, or your initials when there isn't one. */
export function Avatar({ user, size }: { user: S["Me"]["user"]; size: number }) {
  if (user.photo)
    return <Image src={user.photo} alt="" width={size} height={size} className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />;
  return (
    <span
      aria-hidden
      className="grid shrink-0 place-items-center rounded-full bg-stone font-semibold text-highlight-foreground"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }}
    >
      {user.initials}
    </span>
  );
}
