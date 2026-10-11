type FredMarkProps = {
  /** Light the panes up in turn, for when Fred is working. */
  working?: boolean;
  className?: string;
  /** Accessible name. Leave it out when the mark sits next to the word "Fred". */
  title?: string;
};

// The window mark: a box with a cross. Animation lives in globals.css (.fred-pane).
export function FredMark({ working = false, className = "", title }: FredMarkProps) {
  return (
    <svg
      viewBox="0 0 20 26"
      className={`${working ? "fred-mark-working " : ""}${className}`}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <rect className="fred-pane" x="2.5" y="2.5" width="6.5" height="9.5" />
      <rect className="fred-pane fred-pane-2" x="11" y="2.5" width="6.5" height="9.5" />
      <rect className="fred-pane fred-pane-3" x="2.5" y="14" width="6.5" height="9.5" />
      <rect className="fred-pane fred-pane-4" x="11" y="14" width="6.5" height="9.5" />
      <rect x="1.5" y="1.5" width="17" height="23" rx="2" fill="none" stroke="currentColor" strokeWidth="1.25" />
      <path d="M10 1.5v23M1.5 13h17" stroke="currentColor" strokeWidth="1.25" />
    </svg>
  );
}
