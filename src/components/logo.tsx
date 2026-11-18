// The Sabaq mark: a lowercase "s" and a dot, white on brand blue. The "s" is the Geist SemiBold glyph
// turned into an outline, so the mark looks the same everywhere without loading a font.
// Keep in sync with src/app/icon.svg and public/brand/*.

export const BRAND_BLUE = "#2563EB";

/** Geist SemiBold "s" (font units, 1000/em, baseline at y=0). */
const S_PATH =
  "M287 12Q165 12 105 -39Q45 -90 39 -168L170 -174Q177 -132 203.5 -109Q230 -86 288 -86Q333 -86 356.5 -100.5Q380 -115 380 -146Q380 -164 371.5 -176Q363 -188 338.5 -197Q314 -206 267 -215Q186 -229 140 -249.5Q94 -270 75.5 -301Q57 -332 57 -378Q57 -452 114.5 -499Q172 -546 283 -546Q360 -546 409.5 -521.5Q459 -497 484.5 -456.5Q510 -416 514 -366L384 -360Q382 -398 358 -423Q334 -448 281 -448Q236 -448 212.5 -430Q189 -412 189 -382Q189 -350 211.5 -334.5Q234 -319 294 -309Q376 -297 424 -276Q472 -255 492.5 -223.5Q513 -192 513 -148Q513 -71 451.5 -29.5Q390 12 287 12Z";

/** "s." centered in a 64×64 box. */
export function MarkGlyph({ fill = "#fff" }: { fill?: string }) {
  return (
    <g fill={fill}>
      <path d={S_PATH} transform="translate(13.6 44.4) scale(0.0466)" />
      <circle cx="44.6" cy="41" r="4" />
    </g>
  );
}

/** App-icon style mark (rounded blue square). Size it with className, e.g. "h-8 w-8". */
export function LogoMark({ className, title }: { className?: string; title?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      <rect width="64" height="64" rx="15" fill={BRAND_BLUE} />
      <MarkGlyph />
    </svg>
  );
}

/** Wordmark: the name followed by a blue dot, matching the mark. */
export function Wordmark({ name, className }: { name: string; className?: string }) {
  return (
    <span className={className}>
      {name.toLowerCase()}
      <span style={{ color: BRAND_BLUE }}>.</span>
    </span>
  );
}
