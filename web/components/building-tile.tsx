export type BuildingType = "stone" | "brick" | "glass";

// A tiny drawing of the building type, where other apps would show a logo or photo.
export function BuildingTile({ type }: { type: BuildingType }) {
  return (
    <span className="grid size-10 shrink-0 place-items-end justify-center overflow-hidden rounded-[9px] bg-muted" aria-hidden>
      {type === "stone" && (
        <svg width="30" height="34" viewBox="0 0 34 38">
          <rect className="fill-stone" x="3" y="4" width="28" height="34" rx="1" />
          <g className="fill-window">
            <rect x="7" y="9" width="5" height="5" />
            <rect x="15" y="9" width="5" height="5" />
            <rect x="23" y="9" width="5" height="5" />
            <rect x="7" y="18" width="5" height="5" />
            <rect x="15" y="18" width="5" height="5" />
            <rect x="23" y="18" width="5" height="5" />
            <rect x="14" y="28" width="7" height="10" />
          </g>
        </svg>
      )}
      {type === "brick" && (
        <svg width="30" height="34" viewBox="0 0 34 38">
          <rect className="fill-brick" x="2" y="10" width="30" height="28" rx="1" />
          <g className="fill-window">
            <rect x="6" y="14" width="4" height="6" />
            <rect x="13" y="14" width="4" height="6" />
            <rect x="20" y="14" width="4" height="6" />
            <rect x="6" y="24" width="4" height="6" />
            <rect x="13" y="24" width="4" height="6" />
            <rect x="20" y="24" width="4" height="6" />
          </g>
        </svg>
      )}
      {type === "glass" && (
        <svg width="30" height="36" viewBox="0 0 34 40">
          <rect className="fill-glass" x="6" y="2" width="22" height="38" rx="1" />
          <g className="fill-window" opacity=".55">
            <rect x="6" y="9" width="22" height="1.2" />
            <rect x="6" y="16" width="22" height="1.2" />
            <rect x="6" y="23" width="22" height="1.2" />
            <rect x="6" y="30" width="22" height="1.2" />
            <rect x="16.4" y="2" width="1.2" height="38" />
          </g>
        </svg>
      )}
    </span>
  );
}
