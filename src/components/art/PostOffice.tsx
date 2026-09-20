/**
 * The post office: an isometric sorting house, a stamp press on a gantry, a
 * conveyor carrying envelopes under it, and a pile of finished mail.
 * Drawn on a 200x130 pixel grid with integer coordinates and no anti-aliasing.
 */

const INK = "var(--art-1)";
const MOSS = "var(--art-2)";
const SAGE = "var(--art-3)";
const PAPER = "var(--art-4)";
const SKY_FILL = "var(--art-sky)";
const ACCENT = "var(--art-accent)";

function pts(points: Array<[number, number]>): string {
  return points.map(([x, y]) => `${x},${y}`).join(" ");
}

/** Paving flecks: fixed positions, computed once, never random. */
const PAVING: Array<[number, number]> = [];
for (let y = 88; y < 130; y += 6) {
  for (let x = (y / 2) % 8; x < 200; x += 8) {
    PAVING.push([x, y]);
  }
}

const SKY: Array<[number, number]> = [];
for (let y = 6; y < 74; y += 10) {
  for (let x = ((y / 2) % 3) * 9 + 4; x < 200; x += 27) {
    SKY.push([x, y]);
  }
}

function Envelope({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect width="16" height="11" fill={PAPER} stroke={INK} />
      <polyline points={pts([[0, 0], [5, 5], [8, 7], [11, 5], [16, 0]])} fill="none" stroke={INK} />
      <rect x="0" y="9" width="16" height="2" fill={SAGE} />
    </g>
  );
}

export function PostOffice({ title = "A stamp press, a conveyor and the day's mail" }) {
  return (
    <svg
      viewBox="0 0 200 130"
      shapeRendering="crispEdges"
      role="img"
      aria-label={title}
      className="po"
    >
      <rect width="200" height="130" fill={SKY_FILL} />
      {SKY.map(([x, y]) => (
        <rect key={`s${x}-${y}`} x={x} y={y} width="1" height="1" fill={PAPER} opacity="0.7" />
      ))}

      {/* ground */}
      <rect x="0" y="82" width="200" height="48" fill={MOSS} />
      <rect x="0" y="82" width="200" height="1" fill={INK} />
      {PAVING.map(([x, y]) => (
        <rect key={`p${x}-${y}`} x={x} y={y} width="1" height="1" fill={SAGE} opacity="0.6" />
      ))}

      {/* sorting house */}
      <g stroke={INK} strokeWidth="1">
        {/* chimney */}
        <polygon points={pts([[34, 8], [42, 12], [34, 16], [26, 12]])} fill={PAPER} />
        <polygon points={pts([[26, 12], [34, 16], [34, 26], [26, 22]])} fill={MOSS} />
        <polygon points={pts([[34, 16], [42, 12], [42, 22], [34, 26]])} fill={INK} />

        {/* roof */}
        <polygon points={pts([[56, 14], [100, 36], [56, 58], [12, 36]])} fill={PAPER} />
        <polygon points={pts([[56, 22], [88, 38], [56, 54], [24, 38]])} fill="none" stroke={SAGE} />

        {/* walls */}
        <polygon points={pts([[12, 36], [56, 58], [56, 90], [12, 68]])} fill={MOSS} />
        <polygon points={pts([[56, 58], [100, 36], [100, 68], [56, 90]])} fill={INK} />

        {/* left windows */}
        <polygon points={pts([[20, 40], [34, 47], [34, 59], [20, 52]])} fill={ACCENT} />
        <polygon points={pts([[38, 49], [50, 55], [50, 67], [38, 61]])} fill={ACCENT} />

        {/* right window */}
        <polygon points={pts([[86, 45], [98, 39], [98, 51], [86, 57]])} fill={SAGE} />

        {/* door, awning, step */}
        <polygon points={pts([[68, 48], [86, 39], [88, 41], [70, 50]])} fill={PAPER} />
        <polygon points={pts([[70, 52], [84, 45], [84, 66], [70, 73]])} fill={MOSS} />
        <rect x="81" y="58" width="2" height="2" fill={ACCENT} stroke="none" />
      </g>
      {/* window bars, drawn without outlines so they stay one pixel wide */}
      <rect x="26" y="43" width="1" height="12" fill={MOSS} />
      <rect x="43" y="52" width="1" height="12" fill={MOSS} />
      <rect x="91" y="42" width="1" height="12" fill={MOSS} />

      {/* stamp press gantry */}
      <g stroke={INK} strokeWidth="1">
        <rect x="118" y="50" width="6" height="46" fill={INK} />
        <rect x="152" y="50" width="6" height="46" fill={INK} />
        <rect x="112" y="40" width="52" height="12" fill={PAPER} />
        <rect x="120" y="44" width="3" height="3" fill={MOSS} />
        <rect x="153" y="44" width="3" height="3" fill={MOSS} />
        <g className="po-press">
          <rect x="134" y="50" width="8" height="8" fill={MOSS} />
          <rect x="126" y="56" width="24" height="16" fill={MOSS} />
          <rect x="128" y="72" width="20" height="5" fill={ACCENT} />
        </g>
      </g>

      {/* conveyor */}
      <g stroke={INK} strokeWidth="1">
        <rect x="104" y="96" width="92" height="6" fill={MOSS} />
        <rect x="104" y="102" width="92" height="10" fill={INK} />
        <rect x="107" y="103" width="7" height="8" fill={PAPER} />
        <rect x="145" y="103" width="7" height="8" fill={PAPER} />
        <rect x="186" y="103" width="7" height="8" fill={PAPER} />
      </g>
      <g className="po-tread">
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
          <rect key={i} x={106 + i * 12} y="97" width="3" height="4" fill={SAGE} />
        ))}
      </g>

      {/* mail moving under the press */}
      <g className="po-belt">
        <Envelope x={110} y={85} />
      </g>
      <g className="po-belt po-belt--late">
        <Envelope x={110} y={85} />
      </g>

      {/* mailbox by the door */}
      <g stroke={INK} strokeWidth="1">
        <polygon points={pts([[107, 66], [114, 69], [107, 72], [100, 69]])} fill={PAPER} />
        <polygon points={pts([[100, 69], [107, 72], [107, 84], [100, 81]])} fill={MOSS} />
        <polygon points={pts([[107, 72], [114, 69], [114, 81], [107, 84]])} fill={INK} />
        <polygon points={pts([[109, 75], [112, 73], [112, 76], [109, 78]])} fill={SAGE} />
      </g>

      {/* the day's mail, stacked */}
      <g stroke={INK} strokeWidth="1">
        <rect x="32" y="100" width="40" height="9" fill={PAPER} />
        <rect x="28" y="109" width="40" height="8" fill={PAPER} />
        <rect x="24" y="117" width="40" height="9" fill={PAPER} />
      </g>
      <rect x="36" y="103" width="32" height="1" fill={SAGE} />
      <rect x="32" y="112" width="32" height="1" fill={SAGE} />
      <rect x="28" y="120" width="32" height="1" fill={SAGE} />
    </svg>
  );
}
