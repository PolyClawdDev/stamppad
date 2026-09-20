import { ok } from "@/lib/http";
import { flags } from "@/lib/mode";

export async function GET() {
  return ok({ ok: true, mode: flags().mode, protocol: "stamp-exp/0" });
}
