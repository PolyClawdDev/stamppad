"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { StampMark } from "@/components/art/StampMark";
import { WalletButton, WalletProvider } from "./Wallet";

const NAV = [
  { href: "/", label: "Explore", match: (p: string) => p === "/" },
  // /launches/[mint] is a coin page, not the Launch screen.
  { href: "/launch", label: "Launch", match: (p: string) => p === "/launch" },
  { href: "/convert", label: "Convert", match: (p: string) => p.startsWith("/convert") },
  { href: "/market", label: "Market", match: (p: string) => p.startsWith("/market") },
  { href: "/portfolio", label: "Portfolio", match: (p: string) => p.startsWith("/portfolio") },
];

export function Shell({ children, banner }: { children: React.ReactNode; banner: string }) {
  const path = usePathname();
  return (
    <WalletProvider>
      <div className="page">
        <header className="masthead">
          <div className="shell masthead__in">
            <Link href="/" className="brand">
              <StampMark className="brand__mark" />
              <span className="brand__word">Stamppad</span>
              <span className="badge badge--onink">{banner}</span>
            </Link>
            <nav className="nav" aria-label="Primary">
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={item.match(path) ? "active" : ""}
                  aria-current={item.match(path) ? "page" : undefined}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
            <WalletButton />
          </div>
        </header>

        <main className="shell main">{children}</main>

        <footer className="foot">
          <div className="shell foot__in">
            <span>
              Stamppad — burn on Solana, inscribe on Zcash. Experimental, unaffiliated with Stonk,
              Solana or Zcash.
            </span>
            <span className="cluster">
              <Link className="linky" href="/api/indexer">
                Indexer replay
              </Link>
              <Link className="linky" href="/market">
                Market
              </Link>
            </span>
          </div>
        </footer>
      </div>
    </WalletProvider>
  );
}
