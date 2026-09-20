import { Suspense } from "react";

export default function ConvertLayout({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<p className="muted">Loading convert…</p>}>{children}</Suspense>;
}
