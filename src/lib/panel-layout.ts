/**
 * Which sections the brand page shows, and where. Today every brand gets the default; the page
 * renders from this list rather than a fixed template, so a brand can later carry its own layout
 * (chosen by the founder's assistant for the kind of brand being built) without touching the page.
 */
export const SECTION_IDS = ["score", "brief", "snapshot", "jobs", "activity", "team"] as const;
export type SectionId = (typeof SECTION_IDS)[number];

/** `main` is the wide left column; `side` the narrower right one. On phones they stack, main first. */
export type PanelLayout = { main: SectionId[]; side: SectionId[] };

export function defaultLayout(): PanelLayout {
  return { main: ["score", "brief"], side: ["jobs", "snapshot", "activity", "team"] };
}
