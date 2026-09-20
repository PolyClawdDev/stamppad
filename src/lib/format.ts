/**
 * Display helpers. Exact integer values stay authoritative everywhere else in
 * the codebase; these only shape them for reading. Nothing here rounds a value
 * that a user is asked to authorize.
 */

const GROUP = new Intl.NumberFormat("en-US");

/** Integer base units -> grouped display units, exactly, with no rounding. */
export function formatUnits(base: string | bigint, decimals: number): string {
  let value: bigint;
  try {
    value = typeof base === "bigint" ? base : BigInt(base);
  } catch {
    return String(base);
  }
  const negative = value < 0n;
  if (negative) value = -value;
  const scale = 10n ** BigInt(Math.max(0, decimals));
  const whole = value / scale;
  const fraction = (value % scale).toString().padStart(Math.max(0, decimals), "0").replace(/0+$/, "");
  const sign = negative ? "-" : "";
  return `${sign}${GROUP.format(whole)}${fraction ? `.${fraction}` : ""}`;
}

/** Zatoshi -> ZEC. 1 ZEC = 100,000,000 zatoshi. */
export function formatZec(zat: string | bigint): string {
  return formatUnits(zat, 8);
}

export function shortId(value: string, head = 8, tail = 4): string {
  if (!value) return "";
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

/** Sentence-case a snake_case protocol state for display. */
export function humanState(state: string): string {
  const spaced = state.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Stable per-collection stamp number. Derived from the order the indexer
 * confirmed issuance, so it does not invent a catalogue that does not exist.
 */
export function stampNumbers<T extends { id: string; mint: string; zcashHeight?: number }>(
  stamps: T[],
): Map<string, number> {
  const byMint = new Map<string, T[]>();
  for (const stamp of stamps) {
    const list = byMint.get(stamp.mint) ?? [];
    list.push(stamp);
    byMint.set(stamp.mint, list);
  }
  const out = new Map<string, number>();
  for (const list of byMint.values()) {
    list
      .slice()
      .sort((a, b) => (a.zcashHeight ?? 0) - (b.zcashHeight ?? 0) || (a.id < b.id ? -1 : 1))
      .forEach((stamp, index) => out.set(stamp.id, index + 1));
  }
  return out;
}
