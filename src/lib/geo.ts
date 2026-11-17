// A branch map point from what an admin pastes: "41.3111, 69.2797" or a full Google / Yandex / 2GIS link.
// Exact parsing is code's job (never the model's). Two traps: Yandex writes longitude first (ll=69.27,41.31),
// and short links (maps.app.goo.gl, yandex.uz/maps/-/…) hide the point behind a redirect we do not follow.

export interface GeoPoint {
  lat: number;
  lng: number;
}

const NUM = String.raw`(-?\d{1,3}(?:\.\d+)?)`;

function point(lat: number, lng: number): GeoPoint | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  if (lat === 0 && lng === 0) return null;
  return { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 };
}

function pair(s: string, latFirst: boolean): GeoPoint | null {
  const m = s.match(new RegExp(`^${NUM}\\s*,\\s*${NUM}$`));
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  return latFirst ? point(a, b) : point(b, a);
}

export type GeoParse = { ok: true; point: GeoPoint } | { ok: false; reason: "short_link" | "unknown" };

export function parseGeo(input: string): GeoParse {
  const s = input.trim();
  const plain = pair(s.replace(/\s+/g, " ").replace(/[;]/g, ","), true);
  if (plain) return { ok: true, point: plain };

  let url: URL;
  try {
    url = new URL(s);
  } catch {
    return { ok: false, reason: "unknown" };
  }
  const host = url.hostname.replace(/^www\./, "");
  const text = decodeURIComponent(url.href);

  if (host === "maps.app.goo.gl" || host === "goo.gl" || /\/maps\/-\//.test(url.pathname) || host === "go.2gis.com") return { ok: false, reason: "short_link" };

  if (/yandex\./.test(host)) {
    // Yandex: longitude first, in pt= (the pin) or ll= (the map centre)
    for (const key of ["pt", "ll"]) {
      const v = url.searchParams.get(key);
      const p = v ? pair(v.split("~")[0].split(",").slice(0, 2).join(","), false) : null;
      if (p) return { ok: true, point: p };
    }
    return { ok: false, reason: "unknown" };
  }

  if (/2gis\./.test(host)) {
    // 2GIS: …/geo/69.27,41.31 or m=69.27,41.31/16 — longitude first as well
    const m = text.match(new RegExp(`(?:geo/|m=)${NUM},${NUM}`));
    const p = m ? point(Number(m[2]), Number(m[1])) : null;
    return p ? { ok: true, point: p } : { ok: false, reason: "unknown" };
  }

  // Google: the pin (!3d<lat>!4d<lng>) beats the view centre (@lat,lng); q= / query= / ll= are lat first
  const pin = text.match(new RegExp(`!3d${NUM}!4d${NUM}`));
  if (pin) {
    const p = point(Number(pin[1]), Number(pin[2]));
    if (p) return { ok: true, point: p };
  }
  for (const key of ["q", "query", "ll", "destination"]) {
    const v = url.searchParams.get(key);
    const p = v ? pair(v.replace(/\s+/g, ""), true) : null;
    if (p) return { ok: true, point: p };
  }
  const at = text.match(new RegExp(`@${NUM},${NUM}`));
  if (at) {
    const p = point(Number(at[1]), Number(at[2]));
    if (p) return { ok: true, point: p };
  }
  return { ok: false, reason: "unknown" };
}

export const mapLink = (p: GeoPoint) => `https://www.google.com/maps?q=${p.lat},${p.lng}`;
