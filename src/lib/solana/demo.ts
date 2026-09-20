import nacl from "tweetnacl";
import {
  BURN_CHECKED_IX,
  MEMO_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  decodeBase58Pubkey,
  encodeIntent,
  encodeBase58,
  locatorOuter,
  writeU64LE,
  type CanonicalSolanaTx,
  type MintView,
  type SourceNetwork,
  type TokenAccountView,
} from "../protocol";

export interface DemoKeypair {
  publicKey: string;
  secretKey: Uint8Array;
}

export function generateKeypair(): DemoKeypair {
  const kp = nacl.sign.keyPair();
  return { publicKey: encodeBase58(kp.publicKey), secretKey: kp.secretKey };
}

export function keypairFromSecret(secret: Uint8Array): DemoKeypair {
  const kp = nacl.sign.keyPair.fromSecretKey(secret);
  return { publicKey: encodeBase58(kp.publicKey), secretKey: kp.secretKey };
}

export function ataAddress(owner: string, mint: string): string {
  return encodeBase58(
    nacl.hash(Buffer.from(`ata:${owner}:${mint}`, "utf8")).subarray(0, 32),
  );
}

export function randomSignature(): string {
  return encodeBase58(nacl.randomBytes(64).subarray(0, 64));
}

export function randomMint(): string {
  return encodeBase58(nacl.randomBytes(32));
}

export function signMessage(secret: Uint8Array, message: Uint8Array): Uint8Array {
  return nacl.sign.detached(message, secret);
}

export function verifyMessage(publicKey: string, message: Uint8Array, signature: Uint8Array): boolean {
  try {
    return nacl.sign.detached.verify(message, signature, decodeBase58Pubkey(publicKey));
  } catch {
    return false;
  }
}

export interface DemoMintState extends MintView {
  name: string;
  symbol: string;
  description: string;
  imageDataUrl: string | null;
  quoteMint: string;
  quoteSymbol: string;
  launchSupply: string;
  poolBase: string;
  creator: string;
  launchTx: string;
  createdAt: string;
}

export interface DemoChainState {
  slot: number;
  mints: Record<string, DemoMintState>;
  accounts: Record<string, TokenAccountView>;
  txs: Record<string, CanonicalSolanaTx>;
}

export function emptyChain(): DemoChainState {
  return { slot: 1, mints: {}, accounts: {}, txs: {} };
}

export function credit(
  chain: DemoChainState,
  mint: DemoMintState,
  owner: string,
  amount: bigint,
): TokenAccountView {
  const address = ataAddress(owner, mint.address);
  const existing = chain.accounts[address];
  const next: TokenAccountView = existing
    ? { ...existing, amount: existing.amount + amount }
    : {
        address,
        mint: mint.address,
        owner,
        amount,
        delegate: null,
        delegatedAmount: 0n,
        frozen: false,
      };
  chain.accounts[address] = next;
  mint.supply += amount;
  chain.mints[mint.address] = mint;
  return next;
}

export function launchDemoMint(input: {
  chain: DemoChainState;
  creator: string;
  name: string;
  symbol: string;
  description: string;
  imageDataUrl: string | null;
  quoteMint: string;
  quoteSymbol: string;
  supply: bigint;
  totalSellA: bigint;
  decimals: number;
  buyBase?: bigint;
}): { mint: DemoMintState; tx: CanonicalSolanaTx; creatorBalance: bigint } {
  const mintPk = randomMint();
  const launchTx = randomSignature();
  const mint: DemoMintState = {
    address: mintPk,
    programId: TOKEN_PROGRAM_ID,
    supply: 0n,
    decimals: input.decimals,
    initialized: true,
    extensions: [],
    name: input.name,
    symbol: input.symbol,
    description: input.description,
    imageDataUrl: input.imageDataUrl,
    quoteMint: input.quoteMint,
    quoteSymbol: input.quoteSymbol,
    launchSupply: input.supply.toString(10),
    poolBase: input.totalSellA.toString(10),
    creator: input.creator,
    launchTx,
    createdAt: new Date().toISOString(),
  };
  input.chain.mints[mintPk] = mint;
  const poolOwner = encodeBase58(nacl.hash(Buffer.from(`pool:${mintPk}`)).subarray(0, 32));
  credit(input.chain, mint, poolOwner, input.totalSellA);
  const creatorBuy = input.buyBase ?? 0n;
  if (creatorBuy > 0n) {
    credit(input.chain, mint, input.creator, creatorBuy);
  }
  const tx: CanonicalSolanaTx = {
    signature: launchTx,
    slot: ++input.chain.slot,
    network: "solana:demo",
    commitment: "finalized",
    err: null,
    signers: [input.creator],
    instructions: [],
    tokenAccounts: {},
    mint,
  };
  input.chain.txs[launchTx] = tx;
  return { mint, tx, creatorBalance: creatorBuy };
}

export function executeDemoBurn(input: {
  chain: DemoChainState;
  owner: string;
  mint: string;
  amountBase: bigint;
  destinationNetwork: "zcash:demo" | "zcash:test" | "zcash:main";
  destination: string;
  nonce: string;
  fail?: boolean;
  network?: SourceNetwork;
}): CanonicalSolanaTx {
  const mint = input.chain.mints[input.mint];
  if (!mint) throw new Error("Unknown mint on this deployment's ledger.");
  const address = ataAddress(input.owner, input.mint);
  const account = input.chain.accounts[address];
  if (!account || account.amount < input.amountBase) {
    throw new Error("Wallet does not hold that many units. Launch pool inventory is not yours to burn.");
  }

  const intent = encodeIntent({
    version: 0,
    destinationNetwork: input.destinationNetwork,
    destination: input.destination,
    amountBase: input.amountBase,
    mint: input.mint,
    nonce: input.nonce,
  });
  const burnData = Buffer.alloc(10);
  burnData.writeUInt8(BURN_CHECKED_IX, 0);
  writeU64LE(burnData, 1, input.amountBase);
  burnData.writeUInt8(mint.decimals, 9);

  if (!input.fail) {
    account.amount -= input.amountBase;
    mint.supply -= input.amountBase;
    input.chain.accounts[address] = account;
    input.chain.mints[input.mint] = mint;
  }

  const signature = randomSignature();
  const tx: CanonicalSolanaTx = {
    signature,
    slot: ++input.chain.slot,
    network: input.network ?? "solana:demo",
    commitment: "finalized",
    err: input.fail ? { InstructionError: [0, "failed"] } : null,
    signers: [input.owner],
    instructions: [
      {
        locator: locatorOuter(0),
        instruction: {
          programId: TOKEN_PROGRAM_ID,
          accounts: [address, input.mint, input.owner],
          data: new Uint8Array(burnData),
        },
      },
      {
        locator: locatorOuter(1),
        instruction: {
          programId: MEMO_PROGRAM_ID,
          accounts: [],
          data: intent,
        },
      },
    ],
    tokenAccounts: { [address]: { ...account } },
    mint: { ...mint },
  };
  input.chain.txs[signature] = tx;
  return tx;
}

export function eligibleBalance(chain: DemoChainState, owner: string, mint: string): bigint {
  const account = chain.accounts[ataAddress(owner, mint)];
  return account && !account.frozen ? account.amount : 0n;
}
