/**
 * Deterministic placeholder artwork. Every pixel is derived from the asset's
 * own identifier, so the same stamp or mint always prints the same picture and
 * nothing is randomised between renders.
 */

function nibbles(seed: string, count: number): number[] {
  const source = seed.replace(/[^0-9a-zA-Z]/g, "");
  const out: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const ch = source[i % source.length] ?? "0";
    const code = ch.charCodeAt(0);
    out.push((code * (i + 7)) % 16);
  }
  return out;
}

/** Symmetric 12x12 pixel motif for a stamp's artwork panel. */
export function StampArt({ seed, className }: { seed: string; className?: string }) {
  const size = 12;
  const half = size / 2;
  const values = nibbles(seed, half * size);
  const cells: Array<{ x: number; y: number; fill: string }> = [];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < half; x += 1) {
      const v = values[y * half + x] ?? 0;
      if (v < 7) continue;
      // the rare nibble prints in gold, so a motif carries one warm mark
      const fill = v > 14 ? "var(--art-accent)" : v > 11 ? "var(--art-4)" : "var(--art-3)";
      cells.push({ x, y, fill });
      cells.push({ x: size - 1 - x, y, fill });
    }
  }
  return (
    <svg
      className={className}
      viewBox="0 0 12 12"
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
    >
      <rect width="12" height="12" fill="var(--art-1)" />
      {cells.map((c) => (
        <rect key={`${c.x}-${c.y}`} x={c.x} y={c.y} width="1" height="1" fill={c.fill} />
      ))}
      <rect x="0" y="0" width="12" height="1" fill="var(--art-2)" />
      <rect x="0" y="11" width="12" height="1" fill="var(--art-2)" />
    </svg>
  );
}

/** Empty plate with a pixel plus: the slot where a stamp has not been made yet. */
export function BlankStampArt({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 12 12"
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="5" y="3" width="2" height="6" fill="var(--art-3)" />
      <rect x="3" y="5" width="6" height="2" fill="var(--art-3)" />
    </svg>
  );
}

/** Stepped-circle "coin" motif for a mint without uploaded artwork. */
export function CoinArt({ seed, className }: { seed: string; className?: string }) {
  const values = nibbles(seed, 16);
  const face = values.slice(0, 9);
  return (
    <svg
      className={className}
      viewBox="0 0 12 12"
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
    >
      <rect width="12" height="12" fill="var(--art-1)" />
      {/* stepped disc */}
      <rect x="4" y="1" width="4" height="1" fill="var(--art-3)" />
      <rect x="2" y="2" width="8" height="1" fill="var(--art-3)" />
      <rect x="1" y="3" width="10" height="6" fill="var(--art-3)" />
      <rect x="2" y="9" width="8" height="1" fill="var(--art-3)" />
      <rect x="4" y="10" width="4" height="1" fill="var(--art-3)" />
      {/* inner field */}
      <rect x="3" y="3" width="6" height="6" fill="var(--art-2)" />
      {face.map((v, i) =>
        v > 6 ? (
          <rect
            key={i}
            x={3 + (i % 3) * 2}
            y={3 + Math.floor(i / 3) * 2}
            width="2"
            height="2"
            fill={v > 12 ? "var(--art-accent)" : "var(--art-3)"}
          />
        ) : null,
      )}
    </svg>
  );
}
