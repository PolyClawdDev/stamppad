import type { CanonicalSolanaTx, ClaimPackage, MintView, TokenAccountView } from "../protocol";
import type { DemoChainState, DemoMintState } from "../solana/demo";
import type { DemoZcashChain } from "../zcash/demo";

function serAccount(a: TokenAccountView) {
  return { ...a, amount: a.amount.toString(10), delegatedAmount: a.delegatedAmount.toString(10) };
}

function deserAccount(a: ReturnType<typeof serAccount>): TokenAccountView {
  return { ...a, amount: BigInt(a.amount), delegatedAmount: BigInt(a.delegatedAmount) };
}

function serMint(m: DemoMintState | MintView) {
  return { ...m, supply: m.supply.toString(10) };
}

function deserMint<T extends DemoMintState | MintView>(m: T & { supply: string | bigint }): T {
  return { ...m, supply: BigInt(m.supply) } as T;
}

function serIx(tx: CanonicalSolanaTx) {
  return {
    ...tx,
    mint: serMint(tx.mint),
    tokenAccounts: Object.fromEntries(
      Object.entries(tx.tokenAccounts).map(([k, v]) => [k, serAccount(v)]),
    ),
    instructions: tx.instructions.map((i) => ({
      ...i,
      instruction: { ...i.instruction, data: Buffer.from(i.instruction.data).toString("base64") },
    })),
  };
}

function deserIx(tx: ReturnType<typeof serIx>): CanonicalSolanaTx {
  return {
    ...tx,
    mint: deserMint(tx.mint as MintView & { supply: string }),
    tokenAccounts: Object.fromEntries(
      Object.entries(tx.tokenAccounts).map(([k, v]) => [k, deserAccount(v)]),
    ),
    instructions: tx.instructions.map((i) => ({
      ...i,
      instruction: {
        ...i.instruction,
        data: Uint8Array.from(Buffer.from(i.instruction.data, "base64")),
      },
    })),
  };
}

/**
 * A claim package carries the whole canonical burn transaction, which means it
 * carries bigint balances and raw instruction bytes. Handing that to
 * JSON.stringify throws on the bigint, and a Uint8Array that does get through
 * comes back as an object with numeric keys. Both stores put claim packages in
 * JSON, so both go through this.
 */
export function serializeClaim(claim: ClaimPackage) {
  return { ...claim, solana: { ...claim.solana, transaction: serIx(claim.solana.transaction) } };
}

export function deserializeClaim(raw: ReturnType<typeof serializeClaim>): ClaimPackage {
  return { ...raw, solana: { ...raw.solana, transaction: deserIx(raw.solana.transaction) } };
}

export function serializeDemo(solana: DemoChainState, zcash: DemoZcashChain) {
  return {
    solana: {
      slot: solana.slot,
      mints: Object.fromEntries(Object.entries(solana.mints).map(([k, v]) => [k, serMint(v)])),
      accounts: Object.fromEntries(Object.entries(solana.accounts).map(([k, v]) => [k, serAccount(v)])),
      txs: Object.fromEntries(Object.entries(solana.txs).map(([k, v]) => [k, serIx(v)])),
    },
    zcash: {
      height: zcash.height,
      fundedZat: zcash.fundedZat.toString(10),
      escrows: Object.fromEntries(
        Object.entries(zcash.escrows ?? {}).map(([k, v]) => [
          k,
          { ...v, amountZat: v.amountZat.toString(10) },
        ]),
      ),
      txs: Object.fromEntries(
        Object.entries(zcash.txs).map(([k, v]) => [
          k,
          {
            ...v,
            outputs: v.outputs.map((o) => ({
              ...o,
              valueZat: o.valueZat.toString(10),
              nullData: o.nullData ? Buffer.from(o.nullData).toString("base64") : null,
            })),
          },
        ]),
      ),
    },
  };
}

export function deserializeDemo(raw: ReturnType<typeof serializeDemo>): {
  solana: DemoChainState;
  zcash: DemoZcashChain;
} {
  return {
    solana: {
      slot: raw.solana.slot,
      mints: Object.fromEntries(
        Object.entries(raw.solana.mints).map(([k, v]) => [k, deserMint(v as DemoMintState & { supply: string })]),
      ),
      accounts: Object.fromEntries(
        Object.entries(raw.solana.accounts).map(([k, v]) => [k, deserAccount(v)]),
      ),
      txs: Object.fromEntries(Object.entries(raw.solana.txs).map(([k, v]) => [k, deserIx(v)])),
    },
    zcash: {
      height: raw.zcash.height,
      fundedZat: BigInt(raw.zcash.fundedZat),
      escrows: Object.fromEntries(
        Object.entries(raw.zcash.escrows ?? {}).map(([k, v]) => [
          k,
          { ...v, amountZat: BigInt(v.amountZat) },
        ]),
      ),
      txs: Object.fromEntries(
        Object.entries(raw.zcash.txs).map(([k, v]) => [
          k,
          {
            ...v,
            outputs: v.outputs.map((o) => ({
              ...o,
              valueZat: BigInt(o.valueZat),
              nullData: o.nullData ? Uint8Array.from(Buffer.from(o.nullData, "base64")) : null,
            })),
          },
        ]),
      ),
    },
  };
}
