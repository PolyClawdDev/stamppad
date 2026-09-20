# STAMP threat model (v0)

## Actors

- **Creator / burner:** signs Solana transactions. Holds a token account.
- **Delegate:** may burn if approved; in v0 they also choose the destination.
- **Publisher:** holds a limited ZEC balance for ZIP-317 fees and a destination dust output. Does not receive burned tokens.
- **Validator:** replays public Solana and Zcash data. Has no keys.
- **Observer:** reads the web app. May be shown Solana market data.

## Assets

- Users' Solana tokens (principal). Destroyed on burn; never intended to sit with STAMP.
- Publisher ZEC (fees only).
- Issuance integrity: accepted stamp units must equal distinct eligible burns.
- User secrets: seed phrases and spending keys.

## Explicit non-goals

STAMP v0 does not provide:

- Price stability or redeemability
- Private ownership
- Shielded Zcash transfers
- Atomic two-chain settlement
- Transfer or trading of stamps
- Affiliation or endorsement by Stonk or Zcash developers

## Threats and mitigations

| Threat | Mitigation |
| --- | --- |
| Server asked for a seed phrase or stores a user key | Never implemented. Demo keys stay in the browser. Live signing is wallet-local. |
| Publisher key on the app server | Live publisher key is a file path for a **separate** worker. Documented isolation. Demo has no real key. |
| Fake burn accepted | Validator requires a successful finalized Token `Burn`/`BurnChecked` for the mint and amount. Tests cover fabricated and failed txs. |
| Memo without burn authority | Same-transaction rule: burn authority must sign. Memo alone is insufficient. |
| Destination swapped after burn | Destination is inside the signed intent. Later changes reject. |
| Double issuance of one burn | Canonical event id + first-accepted-in-order rule. DB unique constraint is extra, not the definition. |
| Two publishers race | Deterministic duplicate_publication tie-break on Zcash txid. |
| Replay on the wrong network | Network ids are in the preimage and validator config. |
| Token-2022 hook / fee / confidential mint | Reject list. Unknown extensions reject. |
| Creator burns LP inventory they do not own | Balances come from the connected wallet's token account, not from launch supply. |
| Silent fallback to mock success | Live adapters throw. UI shows the failure. Demo mode is labeled. |
| Publication fails after burn | Job stays `retryable` / `publication_pending`. Claim package is exportable. No second burn. |
| Solana or Zcash reorg | Finalized-only acceptance on Solana. Confirmation depth on Zcash. Vanish → republish same commitment or `manual_review`. |
| User believes stamp price = token price | UI forbids labeling Solana price as an executable stamp price. No fabricated stamp volume. |
| Indexer infers ownership from a spent inscription output | Never implemented. Ownership changes only on a confirmed transfer record plus a signed authorization that hashes to it. |
| Forged transfer signed by a non-owner | Authorization must verify against the key the current owner's address commits to. Tested. |
| Recipient substituted after the owner signs | The record commits to `sha256(preimage ‖ signature)`, so an altered recipient no longer matches the on-chain commitment. Tested. |
| Transfer replayed at an old sequence | Sequence must equal current + 1. Tested. |
| Same stamp sold to two buyers | Offers are targeted and bind one ownership sequence; the earliest confirmed offer wins, later ones are `conflicting_offer`. The store additionally allows one live listing per stamp. Tested. |
| Seller relists after ownership moved | Listing requires the seller to be the indexer's current owner. Tested. |
| Buyer pays before delivery is possible | The adapter refuses to lock funds until a complete, verified transfer authorization exists. Tested. |
| Seller takes payment and never delivers | The buyer holds the signed authorization before locking funds and can publish it themselves; the seller's claim only reveals the preimage. |
| Buyer takes the stamp and the seller never claims | Seller can claim unilaterally until the CLTV height; failing to do so is a seller liveness failure, disclosed in the UI. |
| Griefing by publishing records for withheld artifacts | Unresolvable records are `pending` and do not consume the sequence. |
| Gift transfer racing an open listing | A transfer is refused while a live listing exists for the stamp. Tested. |
| Stamp issued to an address we cannot verify | Marked non-transferable, with the reason shown; listing and transfer are refused rather than assumed. Tested. |
| User believes a sale is atomic | Marketplace discloses that Zcash cannot enforce stamp ownership, and enumerates the failure modes. |
| User believes they have a ZSA or privacy | Copy states the opposite. ZIP 226/227 called out as draft. |
| Mainnet funds moved in development | Default flags disable live launch, burn, and publish. |

## Residual risks

- Demo mode can be mistaken for production if the banner is ignored. The indicator is persistent.
- A delegate who is allowed to burn can pick a destination the owner dislikes. v0 documents this; owners should not approve unlimited delegates.
- Publisher ZEC can be drained by fee-spam if a live publisher is exposed without rate limits.
- Relay policy could change; payloads are pinned to the 80-byte data budget and single-data-output rule that `zebrad` enforces by default (`DEFAULT_MAX_DATACARRIER_BYTES = 83`).
- Ownership authorizations live off chain. A participant who withholds an artifact cannot steal a stamp, but can leave a sequence unresolved until someone republishes it. Claim and transfer packages are exportable for that reason.
- A seller who abandons a sale after the buyer publishes the transfer loses the proceeds rather than the stamp; there is no dispute process.
- The demo settlement adapter stores the seller's hash-lock secret server-side so the reveal can be replayed. A real deployment must keep that secret in the seller's wallet.
- Independent validators must share the same finalized data. If they are fed different RPC views during a reorg window they may diverge until the window closes; the spec then converges.
