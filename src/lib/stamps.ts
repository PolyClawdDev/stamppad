/**
 * Stamp identity.
 *
 * A stamp is cut from a launch and is known by that launch's name, ticker and
 * artwork. The inscription itself carries only what the protocol has to verify
 * — mint, burn, amount, recipient — so identity is joined back from the launch
 * record. That join happens here, once, on the server, and travels with every
 * stamp the API returns. Screens read it; they do not reassemble it, because
 * five separate reassemblies is how a stamp ends up nameless on one of them.
 *
 * A launch that genuinely carried no name yields a null name, and a mint with
 * no launch record on this deployment yields no identity at all. Neither is
 * filled in with something invented.
 */
import { numberStamps } from "./sales";
import { getStore, type LaunchRow } from "./store";

export interface StampIdentity {
  /** Name the launch was given, or null when it carried none. */
  name: string | null;
  /** Ticker the launch was given. Empty when it carried none. */
  symbol: string;
  /** Artwork uploaded at launch. Null means the generated motif is correct. */
  imageDataUrl: string | null;
  /** Position within its collection, ordered by the height it was inscribed at. */
  number: number;
}

/** The identity a launch lends to every stamp cut from it. */
export function launchIdentity(
  launch: LaunchRow | null | undefined,
): Omit<StampIdentity, "number"> {
  return {
    name: launch?.name.trim() || null,
    symbol: launch?.symbol.trim() ?? "",
    imageDataUrl: launch?.imageDataUrl ?? null,
  };
}

/**
 * Attaches identity to stamp views. Catalogue numbers are positional within a
 * collection, so the whole stamp list is read even when one stamp is asked
 * about: a number derived from a subset would move as the subset changed.
 */
export async function withStampIdentity<T extends { id: string; mint: string }>(
  views: T[],
): Promise<Array<T & StampIdentity>> {
  const store = getStore();
  const [stamps, launches] = await Promise.all([store.listStamps(), store.listLaunches()]);
  const numbers = numberStamps(stamps);
  const byMint = new Map(launches.map((l) => [l.mint, l]));
  return views.map((view) => ({
    ...view,
    ...launchIdentity(byMint.get(view.mint)),
    number: numbers.get(view.id) ?? 1,
  }));
}
