# Evidence gate

The prompt for this build refers to an existing "stamp protocol" for Zcash
inscriptions. **No repository, specification, or reference implementation for
that protocol was supplied, and none was located in public documentation.**
This file records what is missing, what was actually verified, and what this
build does instead. Nothing here claims compatibility with any third-party
stamp protocol.

What this build is: `stamp-exp`, a local, versioned, clearly labeled protocol of
our own, running against simulated Solana and Zcash ledgers. Real burns,
mainnet publication, and real ZEC sales are disabled behind explicit flags.

Last verified: 2026-09-20.

## Missing evidence

| # | Question | Status | What would resolve it |
|---|----------|--------|-----------------------|
| 1 | **Inscription encoding** — what bytes constitute a valid stamp, in which output, with what versioning and magic | **Missing.** No published byte layout was found. | The upstream spec, or a set of mainnet txids whose payloads can be decoded and cross-checked against an independent indexer. |
| 2 | **Burn verification** — which Solana programs, instructions and finality levels count as an eligible burn | **Missing upstream; defined locally.** | Upstream rules for token program coverage, inner-instruction handling, and finality. |
| 3 | **Recipient authorization** — how a Zcash destination is proven to be authorized by the Solana burner | **Missing upstream; defined locally** (same-transaction signed intent memo). | Upstream binding scheme, including how it survives delegated burns. |
| 4 | **Ownership transfer** — what moves a stamp after issuance | **Missing upstream; defined locally.** Explicitly **not** assumed to be the spend of the inscription output. | Upstream transfer rules, or a documented indexer that demonstrates them on mainnet. |
| 5 | **Double-sale prevention** — how conflicting claims on one stamp are resolved | **Missing upstream; defined locally** (sequence binding plus earliest-confirmed-wins). | Upstream conflict resolution and reorg policy. |
| 6 | **Settlement** — how ZEC payment couples to a change of ownership | **Not verifiable as atomic.** See below. | A mechanism that Zcash consensus can enforce, which does not exist for application-level assets. |
| 7 | **Wallet support** — which wallets can produce the required outputs and redeem scripts | **Unverified.** | Wallet documentation or tested integrations for data outputs and P2SH HTLC redemption. |
| 8 | **License** — the terms under which any upstream protocol may be implemented | **Unknown.** No upstream artifact, therefore no license. | The upstream repository's license file. |

Because 1–8 could not be verified, this build ships a labeled local simulation
plus adapter boundaries (`src/lib/modules/`), and refuses live money movement.

## What was verified

These come from primary sources, checked on 2026-09-20.

- **Data output limits.** `zebrad` treats an `OP_RETURN` script larger than
  `DEFAULT_MAX_DATACARRIER_BYTES` (83 bytes, i.e. 80 data bytes plus opcode and
  pushdata overhead) as non-standard, and permits **at most one** such output
  per transaction. Non-`OP_RETURN` outputs must not be dust.
  Source: Zebra mempool `config.rs` / `storage.rs`, Zebra Book "Mempool
  Specification".
  Consequence: every STAMP payload is designed to fit 80 bytes in one output.
  Issuance uses 38 bytes; ownership records use 74.
- **`zcashd` is end-of-life.** Version 6.20.0 reached its End-of-Support halt at
  block 3,417,100 on 2026-07-18, before NU6.3 mainnet activation. Node
  operations must use Zebra; wallet operations must use Zallet (alpha).
  Source: The `zcashd` Book "End of Life", z.cash "Zcashd Deprecation".
  Consequence: any future live integration targets `zebrad` and Zallet. Earlier
  notes in this repository that referenced `zcashd` RPC as the live path are
  superseded.
- **Transparent HTLCs are specified.** ZIP 300 describes P2SH hash-locked
  contracts with `OP_CHECKLOCKTIMEVERIFY` refund branches for cross-chain atomic
  transactions, and explicitly covers transparent swaps only. ZIP 112 documents
  the `CHECKSEQUENCEVERIFY` constructions. ZIP 300 is Informational and, as its
  own status section states, has not achieved widespread adoption.
  Consequence: a ZEC payment leg can be hash-locked. This is used in the
  settlement design, and its adoption gap is disclosed in the product.
- **Transparent address encodings.** ZIP 320 fixes the P2PKH prefixes
  (`0x1CB8` mainnet, `0x1D25` testnet) and the Bech32m `tex`/`textest` TEX
  encoding. The address validator follows this.
- **Shielded assets are not available.** ZIP 226 and ZIP 227 (ZSA) remain Draft.
  No conversion path is implemented or promised.

## Why settlement cannot be atomic here

Zcash consensus has no notion of a stamp. No script can make a ZEC payment
conditional on a change of stamp ownership, because ownership is an application
record that validators derive off-chain. A hash-locked payment can only be
coupled to *evidence*, not to enforcement.

The design in `docs/PROTOCOL.md` therefore orders the steps so that the buyer
never has funds at risk without already holding a complete, verified transfer
authorization, and the seller can always claim the payment unilaterally. The
residual failure modes are enumerated there and shown in the UI. Real sales stay
disabled (`STAMP_ALLOW_LIVE_STAMP_SALES`) until the HTLC construction, wallet
redemption support, and dispute handling are tested end to end on testnet.

## Rules this build follows

1. No claim of compatibility with any third-party stamp protocol.
2. No invented citations. Anything not verified is marked missing here.
3. Mock and real adapters are separate types, never silent fallbacks
   (`src/lib/modules/`).
4. Real burns, mainnet publication, and real sales are gated by explicit
   environment flags that default to off.
5. The UI states, on every screen that touches money, what the protocol does
   not guarantee.
