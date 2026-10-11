"use client";

import { Bookmark, CalendarDays, FileText, Inbox, PanelLeft, ThumbsDown, UserRound } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";
import { Avatar } from "@/components/avatar";
import { FredMark } from "@/components/fred-mark";
import { useTours, type S } from "@/lib/api/client";
import { tourTime } from "@/lib/format";

const icon = { size: 18, strokeWidth: 1.25, "aria-hidden": true } as const;

// The sidebar folds to a rail of icons. <html data-sidebar="collapsed"> drives both the rail (the
// in-data-[sidebar=collapsed] classes below) and the shell's column (globals.css), and the layout's
// script sets it from localStorage before the first paint, so a reload doesn't jump.
const isCollapsed = () => document.documentElement.dataset.sidebar === "collapsed";
// Watch the attribute itself: the shell also puts it back after a remount (restorePanes).
const watch = (onChange: () => void) => {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-sidebar"] });
  return () => observer.disconnect();
};
export const useSidebarCollapsed = () => useSyncExternalStore(watch, isCollapsed, () => false);

export function toggleSidebar() {
  const collapse = !isCollapsed();
  if (collapse) document.documentElement.dataset.sidebar = "collapsed";
  else delete document.documentElement.dataset.sidebar;
  try {
    localStorage.setItem("fred.sidebar", collapse ? "collapsed" : "open");
  } catch {
    // Storage is off: it stays folded until the next reload.
  }
}

export function Sidebar({ me }: { me: S["Me"] | undefined }) {
  const path = usePathname();
  const collapsed = useSidebarCollapsed();
  const { data: tours } = useTours();
  const nextTour = tours?.find((t) => t.startsAt && t.status !== "cancelled");
  return (
    <aside className="hidden flex-col gap-1 border-r border-sidebar-border bg-sidebar px-2.5 py-3.5 text-sidebar-foreground lg:flex in-data-[sidebar=collapsed]:px-2">
      <div className="flex items-center gap-2.5 px-2 pt-1 pb-3.5 text-[17px] font-semibold tracking-tight in-data-[sidebar=collapsed]:justify-center in-data-[sidebar=collapsed]:px-0">
        <FredMark className="h-[26px] w-5 in-data-[sidebar=collapsed]:hidden" />
        <span className="in-data-[sidebar=collapsed]:hidden">Fred</span>
        <button
          type="button"
          onClick={toggleSidebar}
          aria-label={collapsed ? "Show the sidebar" : "Hide the sidebar"}
          title={collapsed ? "Show the sidebar" : "Hide the sidebar"}
          className="-m-1 ml-auto rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground in-data-[sidebar=collapsed]:mx-0"
        >
          <PanelLeft {...icon} />
        </button>
      </div>

      <nav className="grid gap-0.5 text-[14.5px]">
        <NavItem href="/" current={path === "/"} icon={<Inbox {...icon} />} label="New places" count={me?.counts.new} collapsed={collapsed} />
        <NavItem href="/saved" current={path === "/saved"} icon={<Bookmark {...icon} />} label="Saved" count={me?.counts.saved} quiet collapsed={collapsed} />
        <NavItem href="/passed" current={path === "/passed"} icon={<ThumbsDown {...icon} />} label="Passed" collapsed={collapsed} />
        <NavItem href="/tours" current={path === "/tours"} icon={<CalendarDays {...icon} />} label="Tours" count={me?.counts.tours} quiet collapsed={collapsed} />
        {nextTour?.startsAt && (
          <Link
            href="/tours"
            className="-mt-0.5 mb-1 ml-7 grid rounded-md px-2 py-1 text-[12.5px] leading-snug hover:bg-muted/60 in-data-[sidebar=collapsed]:hidden"
          >
            <span className="font-medium">
              <span className="sr-only">Next tour: </span>
              {tourTime(nextTour.startsAt)}
            </span>
            <span className="truncate text-muted-foreground">{nextTour.address}</span>
          </Link>
        )}
        <NavItem href="/profile" current={path === "/profile"} icon={<UserRound {...icon} />} label="Profile" collapsed={collapsed} />
        <NavItem href="/packet" current={path === "/packet"} icon={<FileText {...icon} />} label="Application packet" collapsed={collapsed} />
      </nav>

      {me && (
        <Link
          href="/profile"
          title={collapsed ? me.user.name : undefined}
          className="mt-auto flex items-center gap-2.5 rounded-lg border-t border-sidebar-border px-2 pt-3 pb-1 hover:bg-muted/60 in-data-[sidebar=collapsed]:justify-center in-data-[sidebar=collapsed]:px-0"
        >
          <Avatar user={me.user} size={30} />
          <div className="min-w-0 leading-tight in-data-[sidebar=collapsed]:sr-only">
            <span className="block truncate">{me.user.name}</span>
            <small className="block truncate text-xs text-muted-foreground">{me.summary}</small>
          </div>
        </Link>
      )}
    </aside>
  );
}

function NavItem({ href, icon, label, count, current, quiet, collapsed }: {
  href: string;
  icon: React.ReactNode;
  label: string;
  count?: number;
  current?: boolean;
  quiet?: boolean;
  /** On the rail, the label is a tooltip. */
  collapsed: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={current ? "page" : undefined}
      title={collapsed ? label : undefined}
      className={`relative flex items-center gap-2.5 rounded-lg px-2 py-[7px] in-data-[sidebar=collapsed]:justify-center ${current ? "bg-muted font-medium" : "hover:bg-muted/60"}`}
    >
      {icon}
      <span className="in-data-[sidebar=collapsed]:sr-only">{label}</span>
      {count ? (
        <span
          className={`ml-auto rounded-full px-[7px] py-[3px] text-[11.5px] leading-none ${
            quiet
              ? "font-medium text-muted-foreground in-data-[sidebar=collapsed]:hidden"
              : "bg-primary font-semibold text-primary-foreground in-data-[sidebar=collapsed]:absolute in-data-[sidebar=collapsed]:top-0 in-data-[sidebar=collapsed]:right-0 in-data-[sidebar=collapsed]:px-1 in-data-[sidebar=collapsed]:text-[10px]"
          }`}
        >
          {count}
        </span>
      ) : null}
    </Link>
  );
}
