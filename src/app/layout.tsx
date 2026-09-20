import type { Metadata } from "next";
import { Shell } from "@/components/Shell";
import "./globals.css";

const TITLE = "StampPad — small stamps, big ideas";
const DESCRIPTION =
  "Discover Solana coins and Zcash stamps. Burn a coin to issue a stamp on Zcash, then own it, send it, or sell the whole stamp for ZEC.";

/**
 * Link previews need absolute URLs. A local development origin would make the
 * card unreachable for Telegram or Slack, so only a public origin is honoured.
 */
const configuredSite = process.env.NEXT_PUBLIC_APP_URL ?? "";
const SITE = /localhost|127\.0\.0\.1/.test(configuredSite)
  ? "https://www.stamppad.fun"
  : configuredSite || "https://www.stamppad.fun";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: TITLE,
  description: DESCRIPTION,
  applicationName: "StampPad",
  openGraph: {
    type: "website",
    siteName: "StampPad",
    url: SITE,
    title: TITLE,
    description: DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
