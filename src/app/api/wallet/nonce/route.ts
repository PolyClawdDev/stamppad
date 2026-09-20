import { ok } from "@/lib/http";
import { nonceStore } from "@/lib/wallet/nonce";
import { requestDomain } from "@/lib/wallet/origin";

/** Issues the single-use nonce the wallet is about to sign, plus the host to name in it. */
export async function POST(request: Request) {
  return ok({ nonce: nonceStore.issue(), domain: requestDomain(request) });
}
