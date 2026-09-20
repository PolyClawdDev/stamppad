import type { Metadata } from "next";
import { demoBanner } from "@/lib/mode";
import { Shell } from "@/components/Shell";
import "./globals.css";

export const metadata: Metadata = {
  title: "Stamppad — small stamps, big ideas",
  description:
    "Discover Solana coins and Zcash stamps. Burn tokens to issue verifiable transparent inscriptions.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Shell banner={demoBanner()}>{children}</Shell>
      </body>
    </html>
  );
}
