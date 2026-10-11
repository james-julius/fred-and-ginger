"use client";

import { Bookmark, CalendarDays, FileText, Inbox, PanelLeft, UserRound } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Avatar } from "@/components/avatar";
import { FredMark } from "@/components/fred-mark";
import { useTours, type S } from "@/lib/api/client";
import { tourTime } from "@/lib/format";

const icon = { size: 18, strokeWidth: 1.25, "aria-hidden": true } as const;

export function Sidebar({ me }: { me: S["Me"] | undefined }) {
  const path = usePathname();
  const router = useRouter();
  const { data: tours } = useTours();
  const nextTour = tours?.find((t) => t.startsAt && t.status !== "cancelled");
  // Open the tour's place in New places. If you're already there, keep the view (list or map) and sort.
  const openPlace = (id: string) => {
    const params = new URLSearchParams(path === "/" ? window.location.search : "");
    params.set("place", id);
    router.push(`/?${params}`, { scroll: false });
  };
  return (
    <aside className="hidden flex-col gap-1 border-r border-sidebar-border bg-sidebar px-2.5 py-3.5 text-sidebar-foreground lg:flex">
      <div className="flex items-center gap-2.5 px-2 pt-1 pb-3.5 text-[17px] font-semibold tracking-tight">
        <FredMark className="h-[26px] w-5" />
        Fred
        <PanelLeft {...icon} className="ml-auto text-muted-foreground" />
      </div>

      {/* Saved, Tours and Application packet don't have pages yet; they lead home for now. */}
      <nav className="grid gap-0.5 text-[14.5px]">
        <NavItem href="/" current={path === "/"} icon={<Inbox {...icon} />} label="New places" count={me?.counts.new} />
        <NavItem href="/" icon={<Bookmark {...icon} />} label="Saved" count={me?.counts.saved} quiet />
        <NavItem href="/" icon={<CalendarDays {...icon} />} label="Tours" count={me?.counts.tours} quiet />
        {nextTour?.startsAt && (
          <button
            type="button"
            onClick={() => openPlace(nextTour.opportunityId)}
            className="-mt-0.5 mb-1 ml-7 grid rounded-md px-2 py-1 text-left text-[12.5px] leading-snug hover:bg-muted/60"
          >
            <span className="font-medium">
              <span className="sr-only">Next tour: </span>
              {tourTime(nextTour.startsAt)}
            </span>
            <span className="truncate text-muted-foreground">{nextTour.address}</span>
          </button>
        )}
        <NavItem href="/profile" current={path === "/profile"} icon={<UserRound {...icon} />} label="Profile" />
        <NavItem href="/" icon={<FileText {...icon} />} label="Application packet" />
      </nav>

      {me && (
        <Link href="/profile" className="mt-auto flex items-center gap-2.5 rounded-lg border-t border-sidebar-border px-2 pt-3 pb-1 hover:bg-muted/60">
          <Avatar user={me.user} size={30} />
          <div className="min-w-0 leading-tight">
            <span className="block truncate">{me.user.name}</span>
            <small className="block truncate text-xs text-muted-foreground">{me.summary}</small>
          </div>
        </Link>
      )}
    </aside>
  );
}

function NavItem({ href, icon, label, count, current, quiet }: {
  href: string;
  icon: React.ReactNode;
  label: string;
  count?: number;
  current?: boolean;
  quiet?: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={current ? "page" : undefined}
      className={`flex items-center gap-2.5 rounded-lg px-2 py-[7px] ${current ? "bg-muted font-medium" : "hover:bg-muted/60"}`}
    >
      {icon}
      {label}
      {count ? (
        <span
          className={`ml-auto rounded-full px-[7px] py-[3px] text-[11.5px] leading-none ${
            quiet ? "font-medium text-muted-foreground" : "bg-primary font-semibold text-primary-foreground"
          }`}
        >
          {count}
        </span>
      ) : null}
    </Link>
  );
}
