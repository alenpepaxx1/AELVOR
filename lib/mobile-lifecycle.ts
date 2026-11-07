// Copyright © 2026 Alen Pepa
type Page = { visibilityState: string; addEventListener: (event: "visibilitychange", listener: () => void) => void; removeEventListener: (event: "visibilitychange", listener: () => void) => void };
export function connectMobileLifecycle(page: Page, enabled: boolean, pause: () => void): () => void {
  if (!enabled) return () => {};
  let hidden = false, closed = false;
  const changed = () => {
    if (closed) return;
    if (page.visibilityState !== "hidden") { hidden = false; return; }
    if (!hidden) { hidden = true; pause(); }
  };
  page.addEventListener("visibilitychange", changed); changed();
  return () => { closed = true; page.removeEventListener("visibilitychange", changed); };
}

type Viewport = { height: number; scale: number; addEventListener: (event: "resize", listener: () => void) => void; removeEventListener: (event: "resize", listener: () => void) => void };
export function connectMobileViewport(viewport: Viewport | null, apply: (height: number | null) => void): () => void {
  if (!viewport) return () => {};
  let closed = false;
  const update = () => {
    if (!closed) apply(viewport.scale === 1 && Number.isFinite(viewport.height) && viewport.height > 0 ? Math.round(viewport.height) : null);
  };
  viewport.addEventListener("resize", update); update();
  return () => { closed = true; viewport.removeEventListener("resize", update); apply(null); };
}
