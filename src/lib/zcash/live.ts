import { flags, liveMoneyMovementBlocked } from "../mode";

export async function assertLivePublishAllowed(): Promise<void> {
  const blocked = liveMoneyMovementBlocked("publish");
  if (blocked) throw new Error(blocked);
  if (!flags().zcashRpc) throw new Error("ZCASH_RPC_URL is required for live publication.");
  if (!process.env.ZCASH_PUBLISHER_KEY_FILE) {
    throw new Error("ZCASH_PUBLISHER_KEY_FILE must point at an isolated publisher key, not an application secret.");
  }
}
