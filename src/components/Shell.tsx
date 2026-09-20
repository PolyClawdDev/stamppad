"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { StampMark } from "@/components/art/StampMark";
import { XMark } from "@/components/art/XMark";
import { WalletButton, WalletProvider } from "./Wallet";

const NAV = [
  { href: "/", label: "Explore", match: (p: string) => p === "/" },
  // /launches/[mint] is the underlying token, not the Issue screen.
  { href: "/launch", label: "Launch", match: (p: string) => p === "/launch" },
  { href: "/market", label: "Market", match: (p: string) => p.startsWith("/market") },
  { href: "/portfolio", label: "Portfolio", match: (p: string) => p.startsWith("/portfolio") },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  return (
    <WalletProvider>
      <div className="page">
        <header className="masthead">
          <div className="shell masthead__in">
            <Link href="/" className="brand">
              <StampMark className="brand__mark" />
              <span className="brand__word">StampPad</span>
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
              StampPad — burn on Solana, inscribe on Zcash. Experimental, unaffiliated with Stonk,
              Solana or Zcash.
            </span>
            <span className="cluster">
              <a
                className="linky"
                href="https://x.com/StampPaddotfun"
                target="_blank"
                rel="noreferrer"
                style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
              >
                <XMark />
                StampPad
              </a>
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
