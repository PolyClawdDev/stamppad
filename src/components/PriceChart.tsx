"use client";

/**
 * Sale-price chart, drawn by hand in SVG so it matches the pixel idiom and
 * adds no dependency.
 *
 * It plots completed sales only. Sparse sales stay sparse: markers sit at the
 * settlement they came from and the connecting line is a step, never a smooth
 * curve that would imply trading in between. An asking price, when shown, is a
 * separately labelled reference line, not a data point.
 */
import { useMemo, useRef, useState } from "react";
import { formatZec } from "@/lib/format";

export interface ChartPoint {
  /** Milliseconds since epoch, or a block height when no clock is available. */
  t: number;
  /** Zatoshi. */
  value: number;
  label: string;
  sub: string;
}

export interface Candle {
  t: number;
  open: number;
  high: number;
  low: number;
  close: number;
  count: number;
}

const W = 640;
const H = 260;
const PAD = { top: 18, right: 16, bottom: 30, left: 62 };
/** Below this a candle chart would be mostly empty buckets pretending to be a market. */
export const CANDLE_MIN_SALES = 12;

export function PriceChart({
  points,
  asking,
  yLabel,
  timeAxis = true,
  candles,
  emptyTitle = "No completed sales yet",
  emptyBody,
}: {
  points: ChartPoint[];
  asking?: { value: number; label: string } | null;
  yLabel: string;
  timeAxis?: boolean;
  candles?: Candle[] | null;
  emptyTitle?: string;
  emptyBody?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const geom = useMemo(() => {
    const values = [
      ...points.map((p) => p.value),
      ...(candles ?? []).flatMap((c) => [c.high, c.low]),
    ];
    if (asking) values.push(asking.value);
    const lo = values.length ? Math.min(...values) : 0;
    const hi = values.length ? Math.max(...values) : 1;
    // A flat series still needs a band, otherwise every point lands on one line.
    const span = hi - lo || Math.max(hi * 0.2, 1);
    const yMin = Math.max(0, lo - span * 0.25);
    const yMax = hi + span * 0.25;

    const ts = [...points.map((p) => p.t), ...(candles ?? []).map((c) => c.t)];
    const tMin = ts.length ? Math.min(...ts) : 0;
    const tMax = ts.length ? Math.max(...ts) : 1;
    const tSpan = tMax - tMin || 1;

    // Inset the series so the first and last markers are not cut by the frame.
    const inner = W - PAD.left - PAD.right;
    const inset = inner * 0.07;
    const x = (t: number) =>
      points.length + (candles?.length ?? 0) === 1
        ? PAD.left + inner / 2
        : PAD.left + inset + ((t - tMin) / tSpan) * (inner - inset * 2);
    const y = (v: number) =>
      H - PAD.bottom - ((v - yMin) / (yMax - yMin || 1)) * (H - PAD.top - PAD.bottom);

    return { x, y, yMin, yMax, tMin, tMax };
  }, [points, candles, asking]);

  if (points.length === 0 && !candles?.length) {
    return (
      <div className="chart chart--empty">
        <div className="chart__emptyinner">
          <PixelMailGlyph />
          <strong className="chart__emptytitle">{emptyTitle}</strong>
          <p className="tiny muted">
            {emptyBody ??
              "A price appears here the moment the indexer accepts a settled transfer. Nothing is estimated in the meantime."}
          </p>
        </div>
      </div>
    );
  }

  const ticks = [geom.yMax, (geom.yMax + geom.yMin) / 2, geom.yMin];
  const hovered = hover === null ? null : points[hover];

  function onMove(event: React.PointerEvent<SVGSVGElement>) {
    if (!points.length || !svgRef.current) return;
    const box = svgRef.current.getBoundingClientRect();
    const px = ((event.clientX - box.left) / box.width) * W;
    let best = 0;
    let bestDist = Infinity;
    points.forEach((p, i) => {
      const d = Math.abs(geom.x(p.t) - px);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    });
    setHover(best);
  }

  return (
    <div className="chart">
      <svg
        ref={svgRef}
        className="chart__svg"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`${yLabel}. ${points.length} completed ${points.length === 1 ? "sale" : "sales"}.`}
        shapeRendering="crispEdges"
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        {/* plot field */}
        <rect
          x={PAD.left}
          y={PAD.top}
          width={W - PAD.left - PAD.right}
          height={H - PAD.top - PAD.bottom}
          className="chart__field"
        />

        {ticks.map((v, i) => (
          <g key={i}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={geom.y(v)}
              y2={geom.y(v)}
              className="chart__grid"
            />
            <text x={PAD.left - 8} y={geom.y(v) + 4} className="chart__ytick" textAnchor="end">
              {formatZec(String(Math.round(v)))}
            </text>
          </g>
        ))}

        {asking && (
          <g>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={geom.y(asking.value)}
              y2={geom.y(asking.value)}
              className="chart__asking"
            />
            <text x={W - PAD.right} y={geom.y(asking.value) - 6} className="chart__askinglabel" textAnchor="end">
              {asking.label}
            </text>
          </g>
        )}

        {candles?.length
          ? candles.map((c) => {
              const bodyTop = geom.y(Math.max(c.open, c.close));
              const bodyBottom = geom.y(Math.min(c.open, c.close));
              const up = c.close >= c.open;
              return (
                <g key={c.t} className={up ? "candle candle--up" : "candle candle--down"}>
                  <line x1={geom.x(c.t)} x2={geom.x(c.t)} y1={geom.y(c.high)} y2={geom.y(c.low)} />
                  <rect
                    x={geom.x(c.t) - 5}
                    y={bodyTop}
                    width={10}
                    height={Math.max(2, bodyBottom - bodyTop)}
                  />
                </g>
              );
            })
          : null}

        {/* step line: price holds at the last sale until the next one settles */}
        {points.length > 1 && (
          <polyline className="chart__step" points={stepPath(points, geom.x, geom.y)} />
        )}

        {points.map((p, i) => (
          <rect
            key={`${p.t}-${i}`}
            x={geom.x(p.t) - 4}
            y={geom.y(p.value) - 4}
            width={8}
            height={8}
            className={hover === i ? "chart__dot chart__dot--on" : "chart__dot"}
          />
        ))}

        {hovered && (
          <line
            x1={geom.x(hovered.t)}
            x2={geom.x(hovered.t)}
            y1={PAD.top}
            y2={H - PAD.bottom}
            className="chart__cursor"
          />
        )}

        {timeAxis && (
          <>
            <text x={PAD.left} y={H - 10} className="chart__xtick">
              {axisDate(geom.tMin, geom.tMax - geom.tMin)}
            </text>
            <text x={W - PAD.right} y={H - 10} className="chart__xtick" textAnchor="end">
              {axisDate(geom.tMax, geom.tMax - geom.tMin)}
            </text>
          </>
        )}
      </svg>

      <div className="chart__legend">
        <span className="chart__key chart__key--sale">Completed sale</span>
        {asking && <span className="chart__key chart__key--ask">{asking.label}</span>}
        <span className="tiny dim">{yLabel}</span>
      </div>

      <div className="chart__readout" aria-live="polite">
        {hovered ? (
          <>
            <strong className="num">{hovered.label}</strong>
            <span className="tiny muted">{hovered.sub}</span>
          </>
        ) : (
          <span className="tiny dim">
            {points.length === 1
              ? "One completed sale. A single point is not a trend."
              : "Hover or tap a marker for the settlement behind it."}
          </span>
        )}
      </div>
    </div>
  );
}

function stepPath(
  points: ChartPoint[],
  x: (t: number) => number,
  y: (v: number) => number,
): string {
  const out: string[] = [];
  points.forEach((p, i) => {
    if (i > 0) out.push(`${x(p.t)},${y(points[i - 1]!.value)}`);
    out.push(`${x(p.t)},${y(p.value)}`);
  });
  return out.join(" ");
}

/** Same-day data needs a clock, months of data needs a date. */
function axisDate(t: number, span: number): string {
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return String(t);
  if (span < 36 * 3600_000) {
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Bucketed candles. Only worth drawing when trades actually fill the buckets. */
export function toCandles(points: ChartPoint[], buckets = 12): Candle[] | null {
  if (points.length < CANDLE_MIN_SALES) return null;
  const tMin = Math.min(...points.map((p) => p.t));
  const tMax = Math.max(...points.map((p) => p.t));
  const width = (tMax - tMin) / buckets || 1;
  const out: Candle[] = [];
  for (let i = 0; i < buckets; i += 1) {
    const from = tMin + i * width;
    const to = i === buckets - 1 ? tMax + 1 : from + width;
    const inside = points.filter((p) => p.t >= from && p.t < to);
    if (!inside.length) continue;
    const values = inside.map((p) => p.value);
    out.push({
      t: from + width / 2,
      open: inside[0]!.value,
      close: inside[inside.length - 1]!.value,
      high: Math.max(...values),
      low: Math.min(...values),
      count: inside.length,
    });
  }
  return out.length >= 4 ? out : null;
}

function PixelMailGlyph() {
  return (
    <svg viewBox="0 0 16 12" className="chart__glyph" shapeRendering="crispEdges" aria-hidden="true">
      <rect x="1" y="2" width="14" height="9" className="chart__glyphbody" />
      <rect x="2" y="3" width="12" height="1" className="chart__glyphline" />
      <rect x="3" y="4" width="10" height="1" className="chart__glyphline" />
      <rect x="4" y="5" width="8" height="1" className="chart__glyphline" />
      <rect x="5" y="6" width="6" height="1" className="chart__glyphline" />
    </svg>
  );
}
