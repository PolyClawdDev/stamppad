import { flags, liveMoneyMovementBlocked } from "../mode";
import { hasPublisherKey } from "./publisher-key";

export async function assertLivePublishAllowed(): Promise<void> {
  const blocked = liveMoneyMovementBlocked("publish");
  if (blocked) throw new Error(blocked);
  if (!flags().zcashRpc) throw new Error("ZCASH_RPC_URL is required for live publication.");
  if (!hasPublisherKey()) {
    throw new Error(
      "ZCASH_PUBLISHER_KEY (WIF or hex) or ZCASH_PUBLISHER_KEY_FILE is required. The key spends only publication fees.",
    );
  }
}
