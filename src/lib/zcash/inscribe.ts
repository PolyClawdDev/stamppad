/**
 * The commit/reveal pipeline that writes a stamp to Zcash.
 *
 * A stamp is an ordinals-style inscription: the payload is too large for
 * zebrad's 80-byte datacarrier limit on OP_RETURN, so it rides in the scriptSig
 * of a P2SH input instead. That takes two transactions.
 *
 *   commit — pays `commitOutputZat` to a P2SH address whose redeem script
 *            contains the publisher's public key and the stamp's 32-byte
 *            commitment. Nobody but the holder of that key can spend it, and
 *            the commitment ties the output to one specific stamp.
 *   reveal — spends that output, pushing the envelope, the signature and the
 *            redeem script in its scriptSig, and paying dust to the address the
 *            burner named. The envelope is now permanently on chain.
 *
 * Nothing here touches a private key. Each builder returns the transaction
 * alongside the exact 32-byte ZIP-244 digests that must be signed, and a
 * `finalize` function accepts the resulting DER signatures. Whatever holds the
 * spending key — an offline machine, a hardware wallet, `zcashd` — never has to
 * be the application server, which is the whole point of the split.
 *
 * Because ZIP-244 made the txid independent of the scriptSigs, the commit's
 * txid is known before the commit is signed. The reveal can therefore be built,
 * and its fee and digest computed, against a commit that does not yet exist.
 */
import { conventionalFee, DUST_THRESHOLD_ZAT, inputSize } from "./fees";
import { consensusBranchId, DEFAULT_EXPIRY_DELTA, type ZcashNetwork } from "./consensus";
import { encodeStamp, type StampPayload } from "./inscription";
import {
  addressForRedeemScript,
  concatBytes,
  inscriptionRedeemScript,
  inscriptionScriptSig,
  MAX_SCRIPT_ELEMENT_SIZE,
  p2shScript,
  pushData,
  scriptForAddress,
} from "./script";
import { hash160 } from "../protocol/hash160";
import {
  bytesToHex,
  hexToBytes,
  internalToTxid,
  SEQUENCE_FINAL,
  serializeTransaction,
  TX_VERSION_V5,
  VERSION_GROUP_ID_V5,
  type TransactionV5,
  type TxInput,
  type TxOutput,
} from "./transaction";
import { signatureDigest, SIGHASH_ALL, txidDigest, type SpentOutput } from "./zip244";

/**
 * The largest DER encoding of a low-S secp256k1 signature, plus the trailing
 * hash type byte. Fees are sized against this so a short signature overpays by
 * a byte or two rather than underpaying and failing to relay.
 */
const MAX_SIGNATURE_PUSH_BYTES = 73;

/** A standard P2PKH scriptSig: push(signature) then push(compressed pubkey). */
const P2PKH_SCRIPTSIG_BYTES = 1 + MAX_SIGNATURE_PUSH_BYTES + 1 + 33;

/** A coin the publisher can spend, as `getaddressutxos` reports it. */
export interface PublisherUtxo {
  txid: string;
  index: number;
  valueZat: bigint;
  scriptPubKeyHex: string;
}

export interface InscriptionPlan {
  /** Envelope bytes, identical to what the reference stamp carries. */
  envelope: Uint8Array;
  redeemScript: Uint8Array;
  /** P2SH address the commit must pay. */
  commitAddress: string;
  commitScriptPubKey: Uint8Array;
  /**
   * Where the reveal delivers dust. Read from the envelope's own `to` field so
   * the output cannot drift from the address the payload names: the indexer in
   * src/lib/inscriptions.ts rejects a stamp whose reveal pays anyone else.
   */
  destination: string;
  /** Dust delivered to the stamp's destination by the reveal. */
  dustZat: bigint;
  revealFeeZat: bigint;
  /** What the commit's P2SH output must hold: dust plus the reveal's fee. */
  commitOutputZat: bigint;
  /** Size the reveal's scriptSig will have once signed, used for the fee. */
  revealScriptSigBytes: number;
}

export interface PlanInput {
  /** The stamp. Encoded by src/lib/zcash/inscription.ts, which is byte-verified. */
  payload: StampPayload;
  /** 33-byte compressed public key the reveal signature will be checked against. */
  revealPublicKey: Uint8Array;
  /** The stamp's 32-byte protocol commitment. */
  commitment: Uint8Array;
  network: ZcashNetwork;
  /** Defaults to the 546 zatoshi relay floor. */
  dustZat?: bigint;
}

/**
 * Works out the commit address and both fees from the envelope alone. Pure, so
 * an operator can be shown exactly what a stamp will cost before anything is
 * signed or any coin is selected.
 */
export function planInscription(input: PlanInput): InscriptionPlan {
  const envelope = encodeStamp(input.payload);
  const redeemScript = inscriptionRedeemScript({
    publicKey: input.revealPublicKey,
    commitment: input.commitment,
  });
  if (redeemScript.length > MAX_SCRIPT_ELEMENT_SIZE) {
    throw new Error("redeem script exceeds the 520-byte push limit");
  }

  const destinationScript = scriptForAddress(input.payload.to);
  const revealScriptSigBytes = concatBytes([
    envelope,
    pushData(new Uint8Array(MAX_SIGNATURE_PUSH_BYTES)),
    pushData(redeemScript),
  ]).length;
  const revealFeeZat = conventionalFee({
    inputScriptSigSizes: [revealScriptSigBytes],
    outputScriptPubKeySizes: [destinationScript.length],
  });

  const dustZat = input.dustZat ?? DUST_THRESHOLD_ZAT;
  if (dustZat < DUST_THRESHOLD_ZAT) {
    throw new Error(`a stamp must deliver at least ${DUST_THRESHOLD_ZAT} zatoshi to be relayed`);
  }

  const scriptHash = hash160(redeemScript);
  return {
    envelope,
    redeemScript,
    commitAddress: addressForRedeemScript(redeemScript, input.network),
    commitScriptPubKey: p2shScript(scriptHash),
    destination: input.payload.to,
    dustZat,
    revealFeeZat,
    commitOutputZat: dustZat + revealFeeZat,
    revealScriptSigBytes,
  };
}

/** Everything a stamp costs the publisher, in zatoshi. */
export interface CostBreakdown {
  commitFeeZat: bigint;
  revealFeeZat: bigint;
  dustZat: bigint;
  totalZat: bigint;
}

/* ---------- commit ---------- */

export interface BuildCommitInput {
  plan: InscriptionPlan;
  /** Coins at the publisher address. Selected largest first. */
  utxos: readonly PublisherUtxo[];
  /** Where the remainder goes. Normally the publisher's own address. */
  changeAddress: string;
  /** Chain tip. Expiry is set DEFAULT_EXPIRY_DELTA blocks past it. */
  tipHeight: number;
  network: ZcashNetwork;
  expiryHeight?: number;
}

export interface UnsignedTransaction {
  tx: TransactionV5;
  /** The coins each input spends, in input order. Needed by ZIP-244. */
  spent: SpentOutput[];
  /** One 32-byte digest per input, in input order. Sign these. */
  sighashes: Uint8Array[];
  /** Known before signing, because ZIP-244 excludes scriptSigs from the txid. */
  txid: string;
  feeZat: bigint;
}

/**
 * Selects coins and builds the funding transaction.
 *
 * The fee is recomputed on every pass rather than guessed, because adding an
 * input raises it: coin selection and fee calculation are the same loop. If the
 * change would land below the dust threshold it is dropped into the fee, since
 * an unspendable output is worse than a slightly generous miner.
 */
export function buildCommit(input: BuildCommitInput): UnsignedTransaction {
  const { plan } = input;
  const changeScript = scriptForAddress(input.changeAddress);
  const candidates = [...input.utxos].sort((a, b) =>
    a.valueZat === b.valueZat ? 0 : a.valueZat > b.valueZat ? -1 : 1,
  );

  const chosen: PublisherUtxo[] = [];
  let feeZat = 0n;
  let changeZat = 0n;
  let funded = false;
  let total = 0n;

  for (const candidate of candidates) {
    chosen.push(candidate);
    total += candidate.valueZat;
    const scriptSigSizes = chosen.map(() => P2PKH_SCRIPTSIG_BYTES);

    const withChange = conventionalFee({
      inputScriptSigSizes: scriptSigSizes,
      outputScriptPubKeySizes: [plan.commitScriptPubKey.length, changeScript.length],
    });
    const remainder = total - plan.commitOutputZat - withChange;
    if (remainder >= DUST_THRESHOLD_ZAT) {
      feeZat = withChange;
      changeZat = remainder;
      funded = true;
      break;
    }

    const withoutChange = conventionalFee({
      inputScriptSigSizes: scriptSigSizes,
      outputScriptPubKeySizes: [plan.commitScriptPubKey.length],
    });
    if (total - plan.commitOutputZat >= withoutChange) {
      // Everything above the commit output goes to the fee.
      feeZat = total - plan.commitOutputZat;
      changeZat = 0n;
      funded = true;
      break;
    }
  }

  if (!funded) {
    const shortfall = plan.commitOutputZat - total;
    throw Object.assign(
      new Error(
        `Publisher has ${total} zatoshi across ${candidates.length} coins, at least ${shortfall} short of a stamp's commit output plus fee.`,
      ),
      { code: "insufficient_publication_funds" },
    );
  }

  const outputs: TxOutput[] = [{ value: plan.commitOutputZat, scriptPubKey: plan.commitScriptPubKey }];
  if (changeZat > 0n) outputs.push({ value: changeZat, scriptPubKey: changeScript });

  const inputs: TxInput[] = chosen.map((utxo) => ({
    prevout: { txid: utxo.txid, index: utxo.index },
    scriptSig: new Uint8Array(0),
    sequence: SEQUENCE_FINAL,
  }));

  const tx = transactionShell(input.network, input.tipHeight, input.expiryHeight, inputs, outputs);
  const spent: SpentOutput[] = chosen.map((utxo) => ({
    value: utxo.valueZat,
    scriptPubKey: hexToBytes(utxo.scriptPubKeyHex),
  }));

  return {
    tx,
    spent,
    sighashes: inputs.map((_, index) => signatureDigest({ tx, spent, index })),
    txid: internalToTxid(txidDigest(tx)),
    feeZat,
  };
}

/* ---------- reveal ---------- */

export interface BuildRevealInput {
  plan: InscriptionPlan;
  /** The commit's txid. Available before the commit is signed. */
  commitTxid: string;
  /** Which output of the commit holds the P2SH coin. buildCommit puts it first. */
  commitIndex?: number;
  tipHeight: number;
  network: ZcashNetwork;
  expiryHeight?: number;
}

export function buildReveal(input: BuildRevealInput): UnsignedTransaction {
  const { plan } = input;
  const inputs: TxInput[] = [
    {
      prevout: { txid: input.commitTxid, index: input.commitIndex ?? 0 },
      scriptSig: new Uint8Array(0),
      sequence: SEQUENCE_FINAL,
    },
  ];
  const outputs: TxOutput[] = [
    { value: plan.dustZat, scriptPubKey: scriptForAddress(plan.destination) },
  ];
  const tx = transactionShell(input.network, input.tipHeight, input.expiryHeight, inputs, outputs);

  // The coin being spent is the commit's P2SH output. ZIP-244 commits to its
  // scriptPubKey, not to the redeem script; see the note in zip244.ts.
  const spent: SpentOutput[] = [
    { value: plan.commitOutputZat, scriptPubKey: plan.commitScriptPubKey },
  ];

  return {
    tx,
    spent,
    sighashes: [signatureDigest({ tx, spent, index: 0 })],
    txid: internalToTxid(txidDigest(tx)),
    feeZat: plan.commitOutputZat - plan.dustZat,
  };
}

/* ---------- finalizing ---------- */

/**
 * Attaches the reveal's signature. `signature` is the DER encoding without the
 * trailing hash type byte, which is appended here so a caller cannot forget it
 * and produce a transaction that fails script evaluation for a reason that
 * looks like a digest error.
 */
export function finalizeReveal(input: {
  unsigned: UnsignedTransaction;
  plan: InscriptionPlan;
  signatureDer: Uint8Array;
}): TransactionV5 {
  const scriptSig = inscriptionScriptSig({
    envelope: input.plan.envelope,
    signature: concatBytes([input.signatureDer, Uint8Array.of(SIGHASH_ALL)]),
    redeemScript: input.plan.redeemScript,
  });
  if (scriptSig.length > input.plan.revealScriptSigBytes) {
    throw new Error(
      `signed reveal scriptSig is ${scriptSig.length} bytes, above the ${input.plan.revealScriptSigBytes} the fee was sized for`,
    );
  }
  return {
    ...input.unsigned.tx,
    inputs: input.unsigned.tx.inputs.map((txin, index) =>
      index === 0 ? { ...txin, scriptSig } : txin,
    ),
  };
}

/** Attaches P2PKH signatures to the commit, one per input, in input order. */
export function finalizeP2pkhInputs(input: {
  unsigned: UnsignedTransaction;
  signatures: readonly { signatureDer: Uint8Array; publicKey: Uint8Array }[];
}): TransactionV5 {
  const { unsigned, signatures } = input;
  if (signatures.length !== unsigned.tx.inputs.length) {
    throw new Error("every input needs its own signature");
  }
  return {
    ...unsigned.tx,
    inputs: unsigned.tx.inputs.map((txin, index) => {
      const { signatureDer, publicKey } = signatures[index]!;
      if (publicKey.length !== 33 && publicKey.length !== 65) {
        throw new Error("a P2PKH scriptSig pushes a 33- or 65-byte public key");
      }
      return {
        ...txin,
        scriptSig: concatBytes([
          pushData(concatBytes([signatureDer, Uint8Array.of(SIGHASH_ALL)])),
          pushData(publicKey),
        ]),
      };
    }),
  };
}

/* ---------- the pair, and what it costs ---------- */

export interface StampTransactions {
  plan: InscriptionPlan;
  commit: UnsignedTransaction;
  reveal: UnsignedTransaction;
  cost: CostBreakdown;
}

/**
 * Builds both halves. The reveal is built against the commit's txid, which
 * ZIP-244 makes available before the commit carries a single signature, so this
 * returns a complete pair with nothing left to recompute after signing.
 */
export function buildStamp(input: {
  plan: InscriptionPlan;
  utxos: readonly PublisherUtxo[];
  changeAddress: string;
  tipHeight: number;
  network: ZcashNetwork;
  expiryHeight?: number;
}): StampTransactions {
  const commit = buildCommit(input);
  const reveal = buildReveal({
    plan: input.plan,
    commitTxid: commit.txid,
    commitIndex: 0,
    tipHeight: input.tipHeight,
    network: input.network,
    expiryHeight: input.expiryHeight,
  });
  return {
    plan: input.plan,
    commit,
    reveal,
    cost: {
      commitFeeZat: commit.feeZat,
      revealFeeZat: input.plan.revealFeeZat,
      dustZat: input.plan.dustZat,
      totalZat: commit.feeZat + input.plan.revealFeeZat + input.plan.dustZat,
    },
  };
}

/** Serialized hex of a finished transaction, ready for sendrawtransaction. */
export function toRawHex(tx: TransactionV5): string {
  return bytesToHex(serializeTransaction(tx));
}

function transactionShell(
  network: ZcashNetwork,
  tipHeight: number,
  expiryHeight: number | undefined,
  inputs: TxInput[],
  outputs: TxOutput[],
): TransactionV5 {
  const expiry = expiryHeight ?? tipHeight + DEFAULT_EXPIRY_DELTA;
  if (expiry <= tipHeight) {
    throw new Error("expiry height must be above the chain tip or the transaction is dead on arrival");
  }
  return {
    version: TX_VERSION_V5,
    versionGroupId: VERSION_GROUP_ID_V5,
    // Bound to the epoch of the block this will be mined in, which for a
    // 40-block expiry window is the tip's epoch unless an upgrade lands inside
    // it. consensusBranchId throws for pre-NU5 heights rather than guessing.
    consensusBranchId: consensusBranchId(expiry, network),
    lockTime: 0,
    expiryHeight: expiry,
    inputs,
    outputs,
    sapling: null,
    orchard: null,
  };
}
