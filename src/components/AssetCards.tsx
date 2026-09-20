import Link from "next/link";
import { CoinArt, StampArt } from "@/components/art/PixelArt";
import { formatUnits, formatZec, humanState, shortId } from "@/lib/format";
import { Badge } from "@/components/ui";

export interface StampCardData {
  id: string;
  mint: string;
  amountBase: string;
  decimals: number;
  collection: string;
  symbol: string;
  number: number;
  listing?: { state: string; priceZat: string } | null;
  /** Newest settled sale, kept strictly separate from the asking price. */
  lastSale?: { priceZat: string; settledAt: string | null; height: number } | null;
  ownedByViewer?: boolean;
}

const CLOSED = ["cancelled", "expired", "failed", "settled"];

/** Canonical URL for a stamp: collection identifier plus inscription identifier. */
export function stampHref(stamp: { mint: string; id: string }): string {
  return `/collections/${stamp.mint}/stamps/${stamp.id}`;
}

/**
 * A single stamp, drawn as postage: perforated edge, square artwork panel,
 * collection, catalogue number, represented quantity, and a price block that
 * keeps "asking" and "sold" visually distinct.
 */
export function StampCard({ stamp, demo }: { stamp: StampCardData; demo: boolean }) {
  const listing = stamp.listing && !CLOSED.includes(stamp.listing.state) ? stamp.listing : null;
  const pending = listing && listing.state !== "listed";
  const status = listing ? (pending ? "Pending" : "Listed") : "Unlisted";
  const action = listing && !pending && !stamp.ownedByViewer ? "Buy" : "View";

  return (
    <Link className="stampcard" href={stampHref(stamp)}>
      <div className="stampcard__art">
        <StampArt seed={stamp.id} />
        <span className="stampcard__denom">
          {formatUnits(stamp.amountBase, stamp.decimals)} {stamp.symbol}
        </span>
      </div>

      <div className="stampcard__body">
        <span className="stampcard__name" title={stamp.collection}>
          {stamp.collection}
        </span>
        <span className="stampcard__meta">
          <span className="mono">No. {stamp.number}</span>
          <span className="num">
            {formatUnits(stamp.amountBase, stamp.decimals)} {stamp.symbol}
          </span>
        </span>
      </div>

      <div className="stampcard__prices">
        <span className="pricecell">
          <span className="pricecell__k">Asking</span>
          <span className={listing ? "pricecell__v price" : "pricecell__v dim"}>
            {listing ? `${formatZec(listing.priceZat)} ZEC` : "Not listed"}
          </span>
        </span>
        <span className="pricecell pricecell--last">
          <span className="pricecell__k">Last sale</span>
          <span className={stamp.lastSale ? "pricecell__v num" : "pricecell__v dim"}>
            {stamp.lastSale ? `${formatZec(stamp.lastSale.priceZat)} ZEC` : "No sales yet"}
          </span>
        </span>
      </div>

      <div className="stampcard__foot">
        <span className="cluster" style={{ gap: 6 }}>
          <Badge state={listing?.state}>{status}</Badge>
          {demo && <Badge>Demo</Badge>}
        </span>
        <span className="linky">{action}</span>
      </div>
    </Link>
  );
}

export interface CoinRowData {
  mint: string;
  name: string;
  symbol: string;
  quoteSymbol?: string;
  imageDataUrl?: string | null;
}

/** A Solana coin. Market venue is named; no price or volume is implied. */
export function CoinRow({
  coin,
  href,
  action = "Open",
  detail,
}: {
  coin: CoinRowData;
  href: string;
  action?: string;
  detail?: React.ReactNode;
}) {
  return (
    <Link className="coin" href={href}>
      <span className="coin__art">
        {coin.imageDataUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={coin.imageDataUrl} alt="" />
        ) : (
          <CoinArt seed={coin.mint} />
        )}
      </span>
      <span style={{ minWidth: 0 }}>
        <span className="coin__name">{coin.name}</span>
        <span className="coin__meta mono">
          {coin.symbol} · {shortId(coin.mint, 6, 4)}
        </span>
      </span>
      <span className="coin__right">
        {detail ?? (coin.quoteSymbol ? <span className="tiny muted">vs {coin.quoteSymbol}</span> : null)}
        <span className="linky">{action}</span>
      </span>
    </Link>
  );
}

export function ListingStateBadge({ state }: { state: string }) {
  return <Badge state={state}>{humanState(state)}</Badge>;
}
