import { ImageResponse } from "next/og";
import { getPublicPage } from "@/lib/services/feedback";

// Rich link card for WhatsApp, X and iMessage, where most share-page links get pasted.
export const alt = "Would you buy this? A brand in progress on Vybd";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const page = await getPublicPage((await params).slug);
  const name = page?.name ?? "A brand in progress";
  const oneLiner = typeof page?.fields.oneLiner === "string" ? page.fields.oneLiner : "";
  const price = typeof page?.fields.price === "string" ? page.fields.price : "";

  const serif = await loadSerif();

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 72,
          background: "#ffffff",
          color: "#0f1b33",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 88, fontFamily: "Instrument Serif", letterSpacing: -1.3, lineHeight: 1.05 }}>{name}</div>
          {oneLiner && <div style={{ marginTop: 24, fontSize: 36, color: "#5b6270", lineHeight: 1.3 }}>{oneLiner.slice(0, 140)}</div>}
          {price && <div style={{ marginTop: 28, fontSize: 30, fontFamily: "monospace" }}>{price}</div>}
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", padding: "16px 28px", borderRadius: 999, background: "#1BB59B", color: "#111827", fontSize: 34, fontWeight: 600 }}>
            Would you buy this?
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 40, fontFamily: "Instrument Serif" }}>
            <svg width="44" height="40" viewBox="4 4 92 84">
              <path d="M4 4 L36 4 L50 46 Z" fill="#5FD6BF" />
              <path d="M4 4 L50 46 L38 88 Z" fill="#1BB59B" />
              <path d="M96 4 L64 4 L50 46 Z" fill="#25324d" />
              <path d="M96 4 L50 46 L62 88 Z" fill="#0f1b33" />
              <path d="M38 88 L50 46 L62 88 Z" fill="#13987F" />
            </svg>
            Vybd
          </div>
        </div>
      </div>
    ),
    { ...size, fonts: serif ? [{ name: "Instrument Serif", data: serif, weight: 400 }] : undefined },
  );
}

// Satori needs raw font bytes. Ask Google Fonts for a TTF (old UA gets truetype), fall back to sans.
async function loadSerif(): Promise<ArrayBuffer | null> {
  try {
    const css = await fetch("https://fonts.googleapis.com/css2?family=Instrument+Serif", {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 6.1)" },
    }).then((r) => r.text());
    const url = css.match(/src: url\((.+?)\) format\('(?:truetype|opentype)'\)/)?.[1];
    return url ? await fetch(url).then((r) => r.arrayBuffer()) : null;
  } catch {
    return null;
  }
}
