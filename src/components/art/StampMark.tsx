/** Perforated stamp logo mark. Pure pixel geometry on a 16x16 grid. */
export function StampMark({ className }: { className?: string }) {
  // Squares in the surrounding colour bite into the paper body to read as perforation.
  const notches = [
    [3, 1],
    [7, 1],
    [11, 1],
    [3, 13],
    [7, 13],
    [11, 13],
    [0, 5],
    [0, 9],
    [14, 5],
    [14, 9],
  ];
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="1" y="2" width="14" height="12" fill="var(--art-4)" />
      {notches.map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width="2" height="2" fill="var(--notch, #161916)" />
      ))}
      <rect x="3" y="4" width="10" height="8" fill="var(--art-2)" />
      <rect x="5" y="6" width="6" height="4" fill="var(--art-3)" />
      {/* envelope flap */}
      <rect x="5" y="6" width="1" height="1" fill="var(--art-1)" />
      <rect x="6" y="7" width="1" height="1" fill="var(--art-1)" />
      <rect x="7" y="8" width="2" height="1" fill="var(--art-1)" />
      <rect x="9" y="7" width="1" height="1" fill="var(--art-1)" />
      <rect x="10" y="6" width="1" height="1" fill="var(--art-1)" />
    </svg>
  );
}
