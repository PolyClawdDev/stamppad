import { fail, ok } from "@/lib/http";
import { tickDemoChain } from "@/lib/market";
import { stampMode } from "@/lib/mode";

/** Demo-only: advances the simulated Zcash chain so pending records confirm. */
export async function POST() {
  if (stampMode() !== "demo") {
    return fail("Chain advancement is a demo-ledger control only.", 409, "not_demo");
  }
  try {
    return ok(await tickDemoChain());
  } catch (error) {
    return fail(error instanceof Error ? error.message : "tick failed");
  }
}
