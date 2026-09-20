import { createDemoLaunch } from "../src/lib/app";
import {
  BURN_CHECKED_IX,
  BURN_IX,
  MEMO_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  encodeBase58,
  encodeIntent,
  locatorOuter,
  writeU64LE,
  type CanonicalSolanaTx,
  type DestNetwork,
  type MintView,
  type SourceNetwork,
  type TokenAccountView,
} from "../src/lib/protocol";
import { FIXTURE_PAIRS } from "../src/lib/stonk/fixtures";

/** Launches are always quoted in Zcash, so the fixture pair list has to carry ZEC. */
export const ZEC_QUOTE_MINT = FIXTURE_PAIRS.find((p) => p.symbol === "ZEC")!.mint;

export const OWNER = "StampOwner11111111111111111111111111111111".slice(0, 43);
export const MINT = "StampMint111111111111111111111111111111111".slice(0, 43);
export const ATA = "StampAta1111111111111111111111111111111111".slice(0, 43);
export const DEST = "zdemo1holderdestination0001";

/**
 * A coin whose creator holds something to burn. Pool inventory is never the
 * creator's, so the optional initial purchase is the only burnable balance and
 * every issuance test has to start by launching one.
 */
export async function launchFundedCoin(
  owner: string,
  buyDisplay = "1000000",
): Promise<{ mint: string; decimals: number }> {
  const launched = await createDemoLaunch({
    owner,
    name: "Test Coin",
    symbol: "TEST",
    description: "",
    imageDataUrl: null,
    quoteMint: ZEC_QUOTE_MINT,
    buyDisplay,
  });
  return { mint: launched.launch.mint, decimals: launched.launch.decimals };
}

export function pubkey(label: string): string {
  const buf = Buffer.alloc(32, 0);
  Buffer.from(label).copy(buf);
  return encodeBase58(buf);
}

export const KEYS = {
  owner: pubkey("owner"),
  mint: pubkey("mint"),
  ata: pubkey("ata"),
  other: pubkey("other"),
};

export function mintView(over: Partial<MintView> = {}): MintView {
  return {
    address: KEYS.mint,
    programId: TOKEN_PROGRAM_ID,
    supply: 1_000_000n,
    decimals: 6,
    initialized: true,
    extensions: [],
    ...over,
  };
}

export function accountView(over: Partial<TokenAccountView> = {}): TokenAccountView {
  return {
    address: KEYS.ata,
    mint: KEYS.mint,
    owner: KEYS.owner,
    amount: 500_000n,
    delegate: null,
    delegatedAmount: 0n,
    frozen: false,
    ...over,
  };
}

export function burnData(amount: bigint, decimals = 6, checked = true): Uint8Array {
  const buf = Buffer.alloc(checked ? 10 : 9);
  buf.writeUInt8(checked ? BURN_CHECKED_IX : BURN_IX, 0);
  writeU64LE(buf, 1, amount);
  if (checked) buf.writeUInt8(decimals, 9);
  return new Uint8Array(buf);
}

export function makeTx(over: {
  amount?: bigint;
  destination?: string;
  destNetwork?: DestNetwork;
  network?: SourceNetwork;
  commitment?: CanonicalSolanaTx["commitment"];
  err?: unknown;
  mint?: MintView;
  account?: TokenAccountView;
  signers?: string[];
  programId?: string;
  skipIntent?: boolean;
  otherDest?: string;
  nonce?: string;
  swapDestAfter?: boolean;
}): CanonicalSolanaTx {
  const amount = over.amount ?? 1000n;
  const mint = over.mint ?? mintView();
  const account = over.account ?? accountView();
  const dest = over.destination ?? DEST;
  const destNetwork = over.destNetwork ?? "zcash:demo";
  const nonce = over.nonce ?? "aa".repeat(16);
  const intent = encodeIntent({
    version: 0,
    destinationNetwork: destNetwork,
    destination: dest,
    amountBase: amount,
    mint: mint.address,
    nonce,
  });
  const instructions = [
    {
      locator: locatorOuter(0),
      instruction: {
        programId: over.programId ?? TOKEN_PROGRAM_ID,
        accounts: [account.address, mint.address, account.delegate ?? account.owner],
        data: burnData(amount, mint.decimals, true),
      },
    },
  ];
  if (!over.skipIntent) {
    instructions.push({
      locator: locatorOuter(1),
      instruction: { programId: MEMO_PROGRAM_ID, accounts: [], data: intent },
    });
  }
  return {
    signature: pubkey(`tx${amount}${nonce.slice(0, 4)}`),
    slot: 10,
    network: over.network ?? "solana:demo",
    commitment: over.commitment ?? "finalized",
    err: over.err ?? null,
    signers: over.signers ?? [account.delegate ?? account.owner],
    instructions,
    tokenAccounts: { [account.address]: account },
    mint,
  };
}
