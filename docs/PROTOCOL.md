# STAMP experimental protocol (stamp-exp / 0)

Status: experimental. Version: **0**. Identifier: **`stamp-exp`**.

This is an application protocol. Zcash consensus does not enforce STAMP issuance or ownership. Independent validators do, by replaying public records.

This specification is not compatible with any unnamed prior project. It is not ZIP 226/227. It does not issue Zcash Shielded Assets. Ordinary stamps are transparent inscriptions.

Integer arithmetic only. Amounts are mint base units (`u64`). Display units are derived as `base / 10^decimals` for UI and must never be used as the issuance quantity.

## 1. Product truths encoded here

- The original token exists on Solana. A launch through Stonk, when it occurs, creates or adopts that Solana mint.
- A stamp is an application-recognized inscription in a transparent Zcash transaction.
- Burning permanently reduces the Solana mint supply.
- A stamp records units burned. It is not redeemable against a reserve.
- One-for-one quantity issuance does not imply price parity.
- Stamps do not provide shielded transfers or private ownership.
- Conversion to ZSAs is **not** specified here and is not automatic.

## 2. Networks

Canonical network ids:

| Id | Meaning |
| --- | --- |
| `solana:demo` | In-process demo ledger |
| `solana:devnet` | Solana devnet |
| `solana:mainnet-beta` | Solana mainnet-beta |
| `zcash:demo` | In-process demo ledger |
| `zcash:test` | Zcash testnet |
| `zcash:main` | Zcash mainnet |

A validator is configured for exactly one source network and one destination network. Mixing networks is a reject.

## 3. Burn event

A burn event is the pair `(sourceTxSignature, burnLocator)`.

`burnLocator` is:

- `outer:<i>` for a top-level instruction at index `i` (0-based)
- `outer:<i>/inner:<j>` for inner instruction `j` of instruction `i`

Two events are the same iff both fields match on the same `sourceNetwork`. Database uniqueness is an implementation aid. Protocol validity is defined on the canonical event, not on a row insert.

## 4. Who may choose the destination

The **burn authority** is the signer that authorized the Token program burn:

| Case | Allowed? | Destination chooser |
| --- | --- | --- |
| Token account owner signs `Burn` / `BurnChecked` | yes | that owner |
| Approved delegate signs, delegated amount ≥ burn | yes | that delegate |
| Permanent delegate signs | **reject** in v0 | — |
| Permissioned burn (co-signer extension) | **reject** in v0 | — |
| Multisig owner, fewer than required signers | reject | — |
| Memo-only destination, no burn-authority signature on the same transaction | reject | — |
| Destination changed after burn by a third party | reject | — |

v0 does not support delegated destination assignment by anyone other than the actual burn signer. If the owner wants a destination, the owner must sign. If a delegate burns, the delegate chooses — and that fact is recorded as `authorityRole: "delegate"`.

An arbitrary memo does **not** prove authority. The memo is admitted only because it is in the **same Solana transaction** that the burn authority signed.

## 5. Authenticated intent (same-transaction memo)

Instruction: SPL Memo program `MemoSq4gqABAXKb96QnHj5ZbxdnGBnVWJChLWKFgS4`.

Binary layout (`IntentV0`), little-endian:

| Offset | Type | Field |
| --- | --- | --- |
| 0 | `b"STMP"` | magic |
| 4 | `u16` | version = 0 |
| 6 | `u8` | destination network code (`0=zcash:demo`, `1=zcash:test`, `2=zcash:main`) |
| 7 | `u8` | destination length `n` (1..=90) |
| 8 | `n` bytes | destination ASCII |
| 8+n | `u64` | amount in base units |
| 16+n | 32 bytes | mint pubkey |
| 48+n | 16 bytes | issuer-chosen nonce |

Maximum encoded size is 8+90+8+32+16 = 154 bytes, within Solana memo limits.

The validator requires:

1. Exactly one parseable `IntentV0` memo in the transaction (top-level or inner).
2. Memo mint equals burn mint.
3. Memo amount equals burn amount.
4. Memo destination network equals the validator's destination network.
5. Destination passes the address rules for that network.
6. The burn authority is a transaction signer.

The binding is independently recoverable: anyone with the Solana transaction can parse burn + memo and check the signer set.

## 6. Eligible burn

A burn instruction is eligible iff all of the following hold.

1. Transaction succeeded (`meta.err == null`).
2. Transaction is **finalized** on the configured source network. Confirmed-but-not-finalized is insufficient for acceptance. It may be tracked as verified-unpublished.
3. Instruction program is the classic Token program or Token-2022.
4. Instruction is `Burn` (8) or `BurnChecked` (15).
5. Account order: `[tokenAccount, mint, authority]`.
6. Decoded amount equals the claimed amount and is `> 0`.
7. Mint pubkey equals the claimed mint.
8. For `BurnChecked`, the instruction decimals equal the mint's decimals.
9. Mint decimals equal the claimed decimals.
10. Token account mint matches.
11. Authority is owner or a delegate with `delegatedAmount >= amount`.
12. Token account is not frozen.
13. Mint is not the native SOL mint.
14. Mint extensions are in the allow set (see §7).
15. A valid `IntentV0` is present as specified in §5.

## 7. Token support

**Allowed**

- Classic SPL mint (82-byte mint account).
- Token-2022 mint whose parsed extensions are only from: metadata pointer, token metadata, mint close authority.

**Rejected** (understandable reasons in the validator)

- Transfer fee
- Transfer hook
- Confidential transfer
- Pausable
- Permissioned burn
- Permanent delegate
- Non-transferable
- Interest-bearing / scaled UI amount
- Default account state = frozen
- Unknown extension type
- Wrong token program owner
- Uninitialized mint

"Any token" means a supported, validated mint. Not every mint.

## 8. Issuance record

Canonical record fields (all required unless noted):

```
protocol            = "stamp-exp"
version             = 0
sourceNetwork       = network id
destinationNetwork  = network id
mint                = base58 mint
tokenProgram        = base58 program
sourceTx            = base58 signature
burnLocator         = locator string
amountBase          = decimal string of u64
decimals            = integer 0..=9  (LaunchLab path uses 6; others as on-chain)
destination         = authorized Zcash address
burnAuthority       = base58
authorityRole       = "owner" | "delegate"
intentLocator       = locator string
nonce               = 32 hex chars
```

After publication, append:

```
zcashTx             = hex txid
zcashOutputIndex    = integer of the destination transparent output
zcashNullDataIndex  = integer of the OP_RETURN output
zcashHeight         = integer
confirmations       = integer
```

`originalRecipient` is `destination`. v0 has **no ownership-transfer rules**. UIs must not call the original recipient the current owner.

## 9. Canonical preimage and commitment

Preimage is UTF-8 lines joined by `0x0A`, no trailing newline, exact field order:

```
stamp-exp
0
<sourceNetwork>
<destinationNetwork>
<mint>
<tokenProgram>
<sourceTx>
<burnLocator>
<amountBase>
<decimals>
<destination>
<burnAuthority>
<authorityRole>
<intentLocator>
<nonce>
```

`commitment = SHA-256(preimage)` (32 bytes).

This is independently recomputable from the Solana transaction plus the mint decimals/program (public mint account).

## 10. Zcash publication encoding

v0 uses a transparent transaction.

Outputs, in this order for the reference publisher (validators accept any order):

1. Destination output: P2PKH/P2SH/TEX matching `destination`, value ≥ `10_000` zatoshis (publisher-funded notice; **not** user principal).
2. Null-data output: script `OP_RETURN OP_PUSHBYTES_38 <payload>`.
3. Optional change to the publisher.

Payload (38 bytes, inside the 80-byte data relay budget documented in `docs/INTEGRATION.md`):

| Offset | Type | Field |
| --- | --- | --- |
| 0 | `b"STMP"` | magic |
| 4 | `u16` | version = 0 |
| 6 | 32 bytes | `commitment` |

Publication fees are ZIP-317 conventional fees paid by the publisher. Paying fees is distinct from custody of burned tokens. Burned tokens are destroyed on Solana; they are not locked with the publisher.

A failed publication **must not** require a second burn. The claim package is the issuance preimage, the Solana transaction, and the commitment. Another compatible publisher can submit a transaction that pays the same destination and the same OP_RETURN payload.

There is no atomic completion across chains.

## 11. Destination address rules

| Network | Accepted |
| --- | --- |
| `zcash:demo` | `zdemo1` followed by 20–80 lowercase alphanumeric characters |
| `zcash:main` | Transparent `t1` / `t3` with valid base58check version bytes, or ZIP-320 `tex1…` bech32m |
| `zcash:test` | Transparent `tm` / `t2` with valid checksum, or `textest1…` |

Shielded `z` addresses and unified addresses are **rejected** in v0. They would hide the original recipient from public validation.

## 12. Confirmation, ordering, duplicates, reorgs

### Solana

Acceptance requires `commitment = finalized`.

If a previously finalized transaction later disappears (theoretically a deep reorg or wrong network):

- Move the issuance to `manual_review` with reason `solana_reorg`.
- Do not auto-accept a replacement event.
- Human or a later spec revision resolves it.

### Zcash

`zcash_confirmation_pending` until `confirmations >= ZCASH_MIN_CONFIRMATIONS` (default 10) and the tx is in the best chain.

If the publication drops below the threshold during a reorg: return to `zcash_confirmation_pending`.

If the publication vanishes: return to `publication_pending` and republish the **same** commitment. Do not burn again.

### Duplicates

If two publications exist for the same burn event:

1. Prefer the publication that first reached the confirmation threshold in the surviving best chain.
2. Tie-break: lower Zcash txid (hex, lexicographic) wins.
3. The loser is `rejected` with `duplicate_publication`.

If two issuance *claims* exist for the same burn event, the first that satisfies §6–§10 in **canonical order** is accepted; others are `duplicate_claim`.

Canonical order of burn events:

1. Solana slot ascending
2. `sourceTx` lexicographic
3. `burnLocator` lexicographic (`outer` then `inner` numeric)

Two independent validators that replay the same canonical finalized transactions in this order produce the same accepted set.

### Concurrent publication

Two publishers may race. Duplicate handling above is deterministic. The burn is not repeated.

## 13. Invariant

Let `A` be the set of accepted issuance records.

```
acceptedStampUnits(mint) = Σ { r.amountBase | r ∈ A, r.mint = mint }
```

using integer addition.

Verified-but-unpublished burns (finalized eligible burns with no accepted Zcash publication) are tracked separately and **must not** be added to `acceptedStampUnits`.

`acceptedStampUnits` equals the sum of distinct eligible burn quantities represented by accepted records. A duplicate claim never increments the sum.

## 14. Job states (implementation)

```
draft
awaiting_authorization
burn_submitted
burn_finalized
publication_pending
zcash_confirmation_pending
confirmed
rejected
retryable
manual_review
```

`retryable` is for publisher fee / RPC failures after a finalized burn. `manual_review` is for reorgs and conflicting evidence.

## 15. Out of scope (v0)

- Shielded publication
- ZSA issuance or migration
- Cross-chain atomicity
- Splitting or merging a stamp
- Treating Solana market price as an executable stamp price

Ownership transfer and whole-stamp sale are specified separately in section 17
as `stamp-exp/1`, and run only against the simulated ledgers.

## 16. Claim package

JSON object:

```
{
  "protocol": "stamp-exp",
  "version": 0,
  "preimage": "<canonical preimage string>",
  "commitmentHex": "<64 hex>",
  "solana": { "network", "signature", "transaction" },
  "destination": "...",
  "zcashPayloadHex": "<76 hex of 38-byte payload>",
  "notes": "Another publisher may create a transparent transaction paying destination and this OP_RETURN. Do not burn again."
}
```

---

# stamp-exp/1 — ownership and settlement

Version 1 adds ownership records on top of version 0 issuance. It changes no
issuance rule. It is experimental and runs against simulated ledgers only.

## 17. What does not move a stamp

**Spending the transparent output that carries an inscription does not transfer
the stamp.** Zcash consensus does not know what a stamp is, so the spend of a
UTXO carries no ownership meaning at the application layer. Any indexer that
infers ownership from output spends is implementing a different protocol.

Ownership changes only when **both** of these exist:

1. a **transfer record** committed in an `OP_RETURN` output that has reached the
   confirmation depth, and
2. a **transfer authorization** artifact, signed by the current owner, that
   hashes to the commitment in that record.

Either one alone does nothing.

## 18. Ownership sequence

Issuance defines sequence `0`; the owner at sequence `0` is the authorized
destination in the accepted issuance record (`originalRecipient`).

Transfer `n` is accepted only if `n = currentSequence + 1`. This makes replays
and skipped sequences invalid by construction, and gives every sale a unique
slot to bind to.

## 19. Record encoding

One record per transaction, in a single `OP_RETURN` output. `zebrad` relays at
most one data output per transaction and at most 80 data bytes, so the record
is 74 bytes:

```
magic          4 bytes   "STMX" transfer | "STMO" offer
version        2 bytes   u16 little-endian, = 1
stamp          32 bytes  issuance commitment
sequence       4 bytes   u32 little-endian
artifactHash   32 bytes  sha256(canonical preimage || "\n" || signatureHex)
```

The signature does not fit alongside the commitment in one relayable output, so
the record commits to the artifact and the artifact is published separately.
This is a data-availability assumption, stated plainly: a withheld artifact
leaves the record `authorization_unavailable` and the sequence stays open.

## 20. Transfer authorization

Canonical preimage, newline separated:

```
stamp-exp
1
transfer
<stampCommitmentHex>
<sequence>
<fromAddress>
<toAddress>
<offerHashHex | "none">
<preimageHex | "none">
```

A validator accepts the transfer when all hold:

1. the artifact hashes to the record's `artifactHash`;
2. `stampCommitmentHex` and `sequence` match the record;
3. `sequence = currentSequence + 1`;
4. `fromAddress` is the current owner;
5. the signature verifies against the key that the owner address commits to;
6. the record is in the best chain at or beyond the confirmation depth;
7. if an offer is bound at this sequence, the transfer satisfies section 22.

Key binding, demo: a `zdemo1<40 hex>` address is
`sha256(ed25519 public key)[0..20]`, so authorization is verifiable end to end.
Key binding, mainnet or testnet: **not implemented.** A stamp issued to an
external transparent address is valid and verifiable, but this build cannot
prove control of that address, so it refuses to transfer or list it rather than
guessing. The UI says so on the stamp.

## 21. Settlement offers

An offer binds one ownership sequence to one named buyer. Offers are targeted,
not open: a buyer is named before any payment exists, which removes the race
where two buyers pay for the same stamp.

Canonical preimage:

```
stamp-exp
1
offer
<stampCommitmentHex>
<sequence>
<sellerAddress>
<buyerAddress>
<priceZat>
<hashLockHex>
<expiryHeight>
```

The **first confirmed** offer at a sequence binds it. Later offers at the same
sequence are rejected as `conflicting_offer`. That is the double-sale rule: one
sequence, one buyer, decided by the chain rather than by the app.

## 22. Delivery

Steps, in this order:

1. Seller picks a secret `R`, publishes a signed offer with `H = sha256(R)`.
2. Seller signs a transfer authorization containing `R` and gives it to the
   buyer off chain. This costs the seller nothing: the seller already knows `R`
   and can claim payment unilaterally.
3. Buyer, now holding a complete authorization, locks ZEC in a ZIP-300 style
   P2SH HTLC on `H` with a `CHECKLOCKTIMEVERIFY` refund branch.
4. Buyer publishes the transfer record.
5. Seller claims the payment, which reveals `R` on chain.

A transfer that pays a bound offer is accepted only if `offerHashHex` equals the
bound offer's artifact hash, `toAddress` equals the offer's buyer, and
`sha256(preimageHex) = hashLockHex`.

**This is not consensus atomicity, and the product does not claim it is.** No
Zcash script can bind a payment to an application-level ownership record. What
the ordering achieves is narrower and worth stating exactly:

- The buyer never has funds at risk without already holding a valid, complete
  authorization.
- The seller can always claim, because the seller knows `R` from the start.
- If the seller never claims, the buyer still owns the stamp and the seller's
  payment refunds at the CLTV height. Loss of the sale proceeds is a seller
  liveness failure, not a buyer risk.
- A reorg that removes the offer or transfer record rolls ownership back. The
  indexer recomputes from scratch, so the rollback is deterministic.

Live sales stay disabled until the HTLC construction and wallet redemption are
tested on testnet: `STAMP_ALLOW_LIVE_STAMP_SALES`.

## 23. Ordering, conflicts, determinism

Records are ordered by `(height, txid, outputIndex)`. Given the same chain data
and the same published artifacts, ownership is a pure function of that order.

- Records below the confirmation depth or outside the best chain are `pending`
  and have no effect.
- A record whose artifact is missing is `pending`, not rejected, and does not
  consume the sequence. Otherwise anyone could freeze a stamp by publishing a
  record for an artifact they never release.
- A record with an invalid authorization is rejected and does not consume the
  sequence, for the same reason.
- Two valid transfers at the same sequence: the earliest confirmed wins; the
  other is `conflicting_transfer`.

Reject reasons: `unauthorized_transfer`, `wrong_sequence`,
`conflicting_transfer`, `conflicting_offer`, `offer_mismatch`,
`hash_lock_unsatisfied`, `unknown_stamp`, `authorization_unavailable`,
`wrong_network`.

## 24. Quantity

A stamp's quantity is fixed at issuance. There are no split or merge rules, so
there are no partial fills: a listing sells the whole stamp. Introducing either
requires a conservation-preserving specification and is not in this version.

## 25. Invariants (v1)

```
owner(stamp, 0)            = originalRecipient
owner(stamp, n)            = toAddress of the accepted transfer at sequence n
acceptedStampUnits(mint)   unchanged by any transfer or sale
sales(stamp)               ⊆ accepted transfers with a bound offer
```

Transfers never mint, burn, split, or merge units. `acceptedStampUnits` is a
function of eligible burns only.
