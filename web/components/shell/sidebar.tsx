import { Bookmark, CalendarDays, FileText, Inbox, PanelLeft, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { FredMark } from "@/components/fred-mark";

const icon = { size: 18, strokeWidth: 1.25, "aria-hidden": true } as const;

export function Sidebar({ newCount }: { newCount: number }) {
  return (
    <aside className="hidden flex-col gap-1 border-r border-sidebar-border bg-sidebar px-2.5 py-3.5 text-sidebar-foreground lg:flex">
      <div className="flex items-center gap-2.5 px-2 pt-1 pb-3.5 text-[17px] font-semibold tracking-tight">
        <FredMark className="h-[26px] w-5" />
        Fred
        <PanelLeft {...icon} className="ml-auto text-muted-foreground" />
      </div>

      {/* Only New places exists so far. The rest are placeholders for the screens to come. */}
      <nav className="grid gap-0.5 text-[14.5px]">
        <NavItem current icon={<Inbox {...icon} />} label="New places" count={newCount} />
        <NavItem icon={<Bookmark {...icon} />} label="Saved" />
        <NavItem icon={<CalendarDays {...icon} />} label="Tours" count={1} quiet />
        <NavItem icon={<FileText {...icon} />} label="Application packet" />
        <NavItem icon={<SlidersHorizontal {...icon} />} label="Search settings" />
      </nav>

      <div className="mt-auto flex items-center gap-2.5 border-t border-sidebar-border px-2 pt-3">
        <span className="grid size-[30px] shrink-0 place-items-center rounded-full bg-stone text-xs font-semibold text-highlight-foreground" aria-hidden>
          EK
        </span>
        <div className="leading-tight">
          Erin
          <small className="block text-xs text-muted-foreground">Manhattan · 2 bed, 2 bath</small>
        </div>
      </div>
    </aside>
  );
}

function NavItem({ icon, label, count, current, quiet }: {
  icon: React.ReactNode;
  label: string;
  count?: number;
  current?: boolean;
  quiet?: boolean;
}) {
  return (
    <Link
      href="/"
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
