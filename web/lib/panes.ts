// The desktop shell's pane sizes. They're CSS variables on <html> that the grid in globals.css reads,
// so saved sizes can go on before the first paint, and dragging doesn't re-render the app.

export type Pane = "sidebar" | "chat";

const KEY = "fred:panes";
// The sidebar keeps its width. The chat keeps its share of the room after the sidebar, so it grows with the window.
const panes = {
  sidebar: { cssVar: "--sidebar-w", unit: "px", value: (width: number) => width },
  chat: { cssVar: "--chat-share", unit: "", value: (width: number, room: number) => Math.round((width / room) * 1e4) / 1e4 },
};

// "collapsed" or "open". toggleSidebar() in sidebar.tsx writes it and sets <html data-sidebar>.
const SIDEBAR = "fred.sidebar";

/** For a <script> in <head>: applies the saved sizes, and a collapsed sidebar, while the page is still parsing. */
export const restorePanesScript = `try{if(localStorage.getItem(${JSON.stringify(SIDEBAR)})==="collapsed")document.documentElement.dataset.sidebar="collapsed";var p=JSON.parse(localStorage.getItem(${JSON.stringify(KEY)}))||{},v=${JSON.stringify(panes)},s=document.documentElement.style;for(var k in v)if(p[k])s.setProperty(v[k].cssVar,p[k]+v[k].unit)}catch(e){}`;

/** Sizes a pane, given its width and its room (from its left edge to the right of the window). */
export function sizePane(pane: Pane, width: number, room: number, { save = false } = {}) {
  const value = panes[pane].value(width, room);
  apply(pane, value);
  if (save) store(pane, value);
}

/** Puts a pane back to its default size. */
export function resetPane(pane: Pane) {
  apply(pane, null);
  store(pane, null);
}

/** Re-applies what the script did. It runs on load, but in dev React's remount clears <html>'s attributes. */
export function restorePanes() {
  const saved = read();
  for (const pane of Object.keys(panes) as Pane[]) if (saved[pane]) apply(pane, saved[pane]);
  try {
    if (localStorage.getItem(SIDEBAR) === "collapsed") document.documentElement.dataset.sidebar = "collapsed";
  } catch {}
}

function apply(pane: Pane, value: number | null) {
  const { cssVar, unit } = panes[pane];
  if (value === null) document.documentElement.style.removeProperty(cssVar);
  else document.documentElement.style.setProperty(cssVar, `${value}${unit}`);
}

function store(pane: Pane, value: number | null) {
  const saved = read();
  if (value === null) delete saved[pane];
  else saved[pane] = value;
  try {
    localStorage.setItem(KEY, JSON.stringify(saved));
  } catch {}
}

function read(): Partial<Record<Pane, number>> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") ?? {};
  } catch {
    return {};
  }
}
