"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useWallet, walletStateLine } from "@/components/Wallet";
import { Note, Panel, Tech } from "@/components/ui";
import { ARTWORK_MAX_BYTES, ARTWORK_MAX_LABEL } from "@/lib/artwork";
import { formatUnits } from "@/lib/format";
import { describeTransparent, validateTransparentAddress } from "@/lib/protocol/taddr";

/**
 * Issuing a stamp launches a SOL-paired token on the venue and burns the whole
 * creator allocation into the inscription. The stamp is delivered to a Zcash
 * address; the buy that funds it is SOL, which is how Stonk LaunchLab runs.
 */
const SOL_QUOTE = {
  mint: "So11111111111111111111111111111111111111112",
  symbol: "SOL",
  name: "Solana",
};

type Step = "idle" | "issuing" | "stamping" | "building" | "approving";

/** What the deployment will actually do, as the server reports it. */
interface LiveStatus {
  mode: string;
  launchEnabled: boolean;
  burnEnabled: boolean;
  zcashPublishEnabled: boolean;
  launchBlockedReason: string | null;
  burnBlockedReason: string | null;
  publishBlockedReason: string | null;
  stonkReadLive: boolean;
  hasRpc: boolean;
}

interface PreparedLaunch {
  mint: string;
  transactionBase64: string;
  pool: string;
  quote: { symbol: string; decimals: number; amountIn: string };
  allocation: { expectedBase: string; minimumBase: string; decimals: number };
  curve: { platformCurveRule: string | null; matchesVenueDerivation: boolean };
  costs: { totalSol: string; quoteSpend: string; note: string };
  simulation: { ok: boolean; err: unknown; unitsConsumed: number | null; programError: { code: number; name: string | null } | null };
  metadataUri: string;
}

interface PreparedBurn {
  mint: string;
  transactionBase64: string;
  amountBase: string;
  decimals: number;
  memo: string;
  tokenProgram: string;
  simulation: { ok: boolean; err: unknown };
  stampRule: { memoPresent: boolean; memoSignedByAuthority: boolean; burnExecuted: boolean };
}

export default function IssuePage() {
  const { wallet, phase, connect, sendTransaction, zcashDestination, setZcashDestination } =
    useWallet();
  const router = useRouter();
  const [quote, setQuote] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>("idle");
  const [preparedLaunch, setPreparedLaunch] = useState<PreparedLaunch | null>(null);
  const [preparedBurn, setPreparedBurn] = useState<PreparedBurn | null>(null);
  const [sent, setSent] = useState<{ launch: string; burn: string | null } | null>(null);
  const [touchedDestination, setTouchedDestination] = useState(false);
  const [form, setForm] = useState({
    name: "",
    symbol: "",
    description: "",
    denomination: "",
    destination: "",
    imageDataUrl: "" as string | null,
  });

  useEffect(() => {
    void fetch("/api/pairs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quoteMint: SOL_QUOTE.mint }),
    })
      .then((r) => r.json())
      .then((j) => {
        if (j.error) setError(j.error.message);
        else {
          setError(null);
          setQuote(j.data);
        }
      });
  }, []);

  useEffect(() => {
    if (!touchedDestination && zcashDestination) {
      setForm((f) => ({ ...f, destination: zcashDestination }));
    }
  }, [zcashDestination, touchedDestination]);

  const parameters = quote?.parameters as
    | { decimals: number; supplyDisplay: number; supplyBase: string; poolBase: string; note: string }
    | undefined;
  const costs = quote?.costs as Record<string, unknown> | undefined;
  const live = quote?.live as LiveStatus | undefined;
  const mainnet = Boolean(live?.launchEnabled);

  const destinationCheck = useMemo(
    () => (form.destination ? validateTransparentAddress(form.destination) : null),
    [form.destination],
  );
  const destinationReady = Boolean(
    destinationCheck?.ok && destinationCheck.network === "zcash:main",
  );

  async function onImage(file: File) {
    if (file.size > ARTWORK_MAX_BYTES) {
      setError(`Artwork must be ${ARTWORK_MAX_LABEL} or smaller.`);
      return;
    }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    setForm((f) => ({ ...f, imageDataUrl: dataUrl }));
  }

  /**
   * Mainnet path, step one: build the launch and show what it will do.
   *
   * Nothing is signed here. The server returns an unsigned transaction and the
   * simulation it ran against mainnet, and the user sees both before being
   * asked to approve anything.
   */
  async function buildMainnet() {
    setError(null);
    setStep("building");
    const res = await fetch("/api/launches/prepare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        owner: wallet!.publicKey,
        name: form.name,
        symbol: form.symbol,
        description: form.description,
        imageDataUrl: form.imageDataUrl,
        quoteMint: SOL_QUOTE.mint,
        quoteAmountDisplay: form.denomination,
      }),
    });
    const json = await res.json();
    setStep("idle");
    if (json.error) {
      setError(json.error.message);
      return;
    }
    setPreparedLaunch(json.data.launch as PreparedLaunch);
  }

  /** Mainnet path, step two: the user approves the launch in Phantom. */
  async function approveLaunch() {
    if (!preparedLaunch) return;
    setError(null);
    setStep("approving");
    try {
      const signature = await sendTransaction(preparedLaunch.transactionBase64);
      setSent({ launch: signature, burn: null });
      // The allocation exists only once the launch has landed, so the burn is
      // built against the chain rather than predicted.
      const res = await fetch("/api/convert/prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mint: preparedLaunch.mint,
          owner: wallet!.publicKey,
          destination: form.destination,
        }),
      });
      const json = await res.json();
      if (json.error) {
        setError(
          `The launch landed as ${signature}, but the burn could not be built: ${json.error.message}`,
        );
        return;
      }
      setPreparedBurn(json.data.burn as PreparedBurn);
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Phantom could not send the launch.");
    } finally {
      setStep("idle");
    }
  }

  /** Mainnet path, step three: the user approves the irreversible burn. */
  async function approveBurn() {
    if (!preparedBurn) return;
    setError(null);
    setStep("approving");
    try {
      const signature = await sendTransaction(preparedBurn.transactionBase64);
      setSent((prior) => ({ launch: prior?.launch ?? "", burn: signature }));
      setZcashDestination(form.destination);
      const recorded = await fetch("/api/convert/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mint: preparedBurn.mint,
          owner: wallet!.publicKey,
          destination: form.destination,
          amountBase: preparedBurn.amountBase,
          decimals: preparedBurn.decimals,
          sourceTx: signature,
        }),
      });
      const json = await recorded.json();
      setPreparedBurn(null);
      if (json.error) {
        setError(
          `The burn landed as ${signature}, but the stamp job could not be recorded: ${json.error.message}`,
        );
        return;
      }
      router.push(`/jobs/${json.data.job.id}`);
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Phantom could not send the burn.");
    } finally {
      setStep("idle");
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!wallet) {
      await connect();
      return;
    }
    if (mainnet) {
      await buildMainnet();
      return;
    }

    setStep("issuing");
    const launchRes = await fetch("/api/launches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        owner: wallet.publicKey,
        name: form.name,
        symbol: form.symbol,
        description: form.description,
        imageDataUrl: form.imageDataUrl,
        quoteMint: SOL_QUOTE.mint,
        buyDisplay: form.denomination,
      }),
    });
    const launched = await launchRes.json();
    if (launched.error) {
      setStep("idle");
      setError(launched.error.message);
      return;
    }

    // The allocation exists only now, so the burn is a second call.
    setStep("stamping");
    const stampRes = await fetch("/api/convert/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mint: launched.data.launch.mint,
        owner: wallet.publicKey,
        amountDisplay: form.denomination,
        destination: form.destination,
      }),
    });
    const stamped = await stampRes.json();
    if (stamped.error) {
      setStep("idle");
      setError(
        `${stamped.error.message} The token was created, so you can finish this from Convert.`,
      );
      return;
    }

    setZcashDestination(form.destination);
    router.push(`/jobs/${stamped.data.job.id}`);
  }

  const busy = step !== "idle";
  const ready = Boolean(wallet) && destinationReady && form.denomination.trim().length > 0;

  return (
    <div className="split">
      <Panel>
        <h1>Launch a stamp</h1>
        <p className="lede muted" style={{ marginTop: 6 }}>
          A stamp carries the artwork, name and ticker you give it, and records the exact
          denomination it represents. One stamp, one owner, one amount.
        </p>

        <form style={{ marginTop: 16 }} onSubmit={(e) => void submit(e)}>
          <div className="field">
            <label htmlFor="img">Artwork</label>
            <input
              id="img"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void onImage(file);
              }}
            />
            <span className="hint">
              Optional, {ARTWORK_MAX_LABEL} maximum. This is the face of the stamp. Without one it
              gets generated pixel art.
            </span>
          </div>
          <div className="field">
            <label htmlFor="name">Name</label>
            <input
              id="name"
              maxLength={32}
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="symbol">Ticker</label>
            <input
              id="symbol"
              maxLength={10}
              required
              value={form.symbol}
              onChange={(e) => setForm({ ...form, symbol: e.target.value })}
            />
            <span className="hint">Shown on the stamp beside its denomination.</span>
          </div>
          <div className="field">
            <label htmlFor="desc">Description</label>
            <textarea
              id="desc"
              rows={3}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="denomination">
              {mainnet ? `Initial buy (${SOL_QUOTE.symbol})` : "Denomination"}
            </label>
            <input
              id="denomination"
              inputMode="decimal"
              required
              value={form.denomination}
              onChange={(e) => setForm({ ...form, denomination: e.target.value })}
            />
            <span className="hint">
              {mainnet
                ? `How much SOL to spend buying your own allocation at launch. The curve decides how many tokens that is, and all of them are burned to cut the stamp, so this is what sets the stamp's denomination.`
                : "The quantity this stamp represents. It is destroyed permanently to cut the stamp and cannot be redeemed."}
            </span>
          </div>
          <div className="field">
            <label htmlFor="destination">Zcash address</label>
            <input
              id="destination"
              className="mono"
              placeholder="t1…"
              autoComplete="off"
              spellCheck={false}
              required
              value={form.destination}
              onChange={(e) => {
                setTouchedDestination(true);
                setForm({ ...form, destination: e.target.value.trim() });
              }}
            />
            <span className="hint">
              Where the stamp is delivered. A transparent address you control, since the
              inscription is transparent.
            </span>
            {destinationCheck && (
              <span className="hint">
                {destinationReady
                  ? `Checksum valid — ${describeTransparent(destinationCheck)}.`
                  : destinationCheck.ok
                    ? "That is a testnet address. Use a Zcash mainnet transparent address."
                    : destinationCheck.message}
              </span>
            )}
            <span className="hint">
              This build cannot prove control of an outside transparent address, so check it
              carefully. A stamp delivered to the wrong address cannot be recovered.
            </span>
          </div>

          {error && (
            <Note tone="error" title="Cannot issue">
              {error}
            </Note>
          )}

          <button className="btn btn--primary" disabled={busy || (Boolean(wallet) && !ready)} type="submit">
            {!wallet
              ? "Connect Phantom and launch"
              : step === "building"
                ? "Building and simulating…"
                : step === "approving"
                  ? "Waiting for Phantom…"
                  : step === "issuing"
                    ? "Creating…"
                    : step === "stamping"
                      ? "Cutting the stamp…"
                      : mainnet
                        ? "Review the mainnet launch"
                        : "Launch stamp"}
          </button>
          {!wallet && (
            <p className="tiny muted" style={{ marginTop: 8 }}>
              {walletStateLine(phase)}
            </p>
          )}
        </form>
      </Panel>

      <aside className="stack">
        {preparedLaunch && !sent && (
          <Panel tone="sage">
            <h2>Approve this on mainnet?</h2>
            <p className="lede" style={{ marginTop: 6 }}>
              Nothing has happened yet. This transaction is built and simulated but unsigned.
              Approving it in Phantom creates a real token on Solana mainnet and spends real funds.
            </p>
            <dl className="kv" style={{ marginTop: 12 }}>
              <dt>Creates mint</dt>
              <dd className="mono">{preparedLaunch.mint}</dd>
              <dt>SOL you spend</dt>
              <dd>{preparedLaunch.costs.totalSol}</dd>
              <dt>Initial buy</dt>
              <dd>
                {formatUnits(preparedLaunch.quote.amountIn, preparedLaunch.quote.decimals)}{" "}
                {preparedLaunch.quote.symbol}
              </dd>
              <dt>Allocation you get</dt>
              <dd>
                {formatUnits(
                  preparedLaunch.allocation.expectedBase,
                  preparedLaunch.allocation.decimals,
                )}{" "}
                {form.symbol || "tokens"}
              </dd>
              <dt>Then burned</dt>
              <dd>All of it, permanently. This cannot be undone.</dd>
              <dt>Mainnet simulation</dt>
              <dd>
                {preparedLaunch.simulation.ok
                  ? `Succeeded, ${preparedLaunch.simulation.unitsConsumed} compute units.`
                  : `Failed: ${preparedLaunch.simulation.programError?.name ?? JSON.stringify(preparedLaunch.simulation.err)}`}
              </dd>
            </dl>
            <p className="tiny muted" style={{ marginTop: 10 }}>
              {preparedLaunch.costs.note}
            </p>
            {!preparedLaunch.simulation.ok && (
              <Note tone="error" title="Simulation failed, so this is not offered for approval">
                The transaction was rejected by mainnet in simulation, which means sending it would
                waste the fee and create nothing. Nothing is signed.
              </Note>
            )}
            <div className="cluster" style={{ marginTop: 12 }}>
              <button
                className="btn btn--primary"
                type="button"
                disabled={!preparedLaunch.simulation.ok || step === "approving"}
                onClick={() => void approveLaunch()}
              >
                {step === "approving" ? "Waiting for Phantom…" : "Approve in Phantom and launch"}
              </button>
              <button
                className="btn btn--sm"
                type="button"
                onClick={() => setPreparedLaunch(null)}
                disabled={step === "approving"}
              >
                Cancel
              </button>
            </div>
          </Panel>
        )}

        {preparedBurn && (
          <Panel tone="sage">
            <h2>Approve the burn?</h2>
            <p className="lede" style={{ marginTop: 6 }}>
              Your allocation exists now. Burning it destroys those tokens permanently and is what
              the stamp is cut from. There is no way to reverse this and nothing is held in reserve.
            </p>
            <dl className="kv" style={{ marginTop: 12 }}>
              <dt>Burning</dt>
              <dd>
                {formatUnits(preparedBurn.amountBase, preparedBurn.decimals)}{" "}
                {form.symbol || "tokens"}
              </dd>
              <dt>Delivered to</dt>
              <dd className="mono">{preparedBurn.memo}</dd>
              <dt>Stamp rule</dt>
              <dd>
                {preparedBurn.stampRule.memoPresent && preparedBurn.stampRule.memoSignedByAuthority
                  ? "The destination memo is present and signed by the burn authority, so a stamp citing this burn will be accepted."
                  : "The destination memo did not verify. Do not approve this."}
              </dd>
              <dt>Mainnet simulation</dt>
              <dd>{preparedBurn.simulation.ok ? "Succeeded." : `Failed: ${JSON.stringify(preparedBurn.simulation.err)}`}</dd>
            </dl>
            <div className="cluster" style={{ marginTop: 12 }}>
              <button
                className="btn btn--primary"
                type="button"
                disabled={
                  !preparedBurn.simulation.ok ||
                  !preparedBurn.stampRule.memoSignedByAuthority ||
                  step === "approving"
                }
                onClick={() => void approveBurn()}
              >
                {step === "approving" ? "Waiting for Phantom…" : "Approve the irreversible burn"}
              </button>
              <button className="btn btn--sm" type="button" onClick={() => setPreparedBurn(null)}>
                Not now
              </button>
            </div>
          </Panel>
        )}

        {sent && (
          <Panel>
            <h2>What landed on Solana</h2>
            <dl className="kv" style={{ marginTop: 10 }}>
              <dt>Launch</dt>
              <dd className="mono">{sent.launch}</dd>
              <dt>Burn</dt>
              <dd className="mono">{sent.burn ?? "not sent"}</dd>
            </dl>
            {sent.burn && !live?.zcashPublishEnabled && (
              <Note tone="warn" title="The burn is real; the stamp is not published yet">
                The tokens are destroyed and the burn carries your destination, so the stamp is
                claimable the moment publication is enabled. It is not enabled on this deployment:{" "}
                {live?.publishBlockedReason}
              </Note>
            )}
          </Panel>
        )}

        <Panel>
          <h2>What you get</h2>
          <ol className="howto" style={{ marginTop: 10 }}>
            <li>A stamp on Zcash carrying your artwork, name and ticker.</li>
            <li>An inscription recording the exact denomination, destroyed to cut it.</li>
            <li>An asset you can hold, send, or sell whole for ZEC.</li>
          </ol>
          {parameters && (
            <dl className="kv" style={{ marginTop: 12 }}>
              <dt>Priced in</dt>
              <dd>
                {SOL_QUOTE.symbol} — {SOL_QUOTE.name}. The stamp still lands on Zcash.
              </dd>
              <dt>Venue fee</dt>
              <dd>{String(costs?.launchVenue)}</dd>
              <dt>StampPad fee</dt>
              <dd>None. This app takes no cut.</dd>
              <dt>Network cost</dt>
              <dd>{String(costs?.network)}</dd>
            </dl>
          )}
          {!parameters && (
            <p className="tiny muted" style={{ marginTop: 10 }}>
              {error
                ? "The venue did not return published parameters for the SOL pair."
                : "Reading the published parameters…"}
            </p>
          )}
        </Panel>

        <Panel tone="ink">
          <h2>What a stamp is not</h2>
          <ul className="tiny" style={{ marginTop: 8 }}>
            <li>Not a wrapper. Nothing is held in reserve.</li>
            <li>Not redeemable. Matching quantity is not price parity.</li>
            <li>Not shielded. Stamps are transparent Zcash inscriptions.</li>
            <li>Not a future shielded asset. Migration is disabled and unverified.</li>
          </ul>
        </Panel>

        <Panel>
          <h2>How a launch runs</h2>
          <ol className="howto" style={{ marginTop: 10 }}>
            <li>You authorize the burn and name the destination.</li>
            <li>The burn must finalize on Solana before anything is published.</li>
            <li>The inscription is published to Zcash and then confirmed.</li>
          </ol>
          <p className="tiny dim" style={{ marginTop: 10 }}>
            The two chains are not atomic. A finalized burn can sit waiting for publication; the
            job page shows exactly where it is.
          </p>
        </Panel>

        {live && !live.launchEnabled && (
          <Note tone="warn" title="The mainnet path is not enabled here">
            {live.launchBlockedReason}{" "}
            {live.mode === "demo"
              ? "This deployment is in demo mode, so the token, the burn and the inscription are recorded on its own in-process ledger and nothing touches Solana or Zcash."
              : "Nothing is recorded on Solana from this page while it is off."}{" "}
            The destination you name is carried through unchanged.
          </Note>
        )}

        {live?.launchEnabled && (
          <Note tone="warn" title="This spends real money on Solana mainnet">
            Launching here creates a real Token-2022 mint on Solana mainnet and spends the SOL you
            name to buy the allocation (plus rent). The allocation
            is then burned, which destroys those tokens permanently and cannot be reversed. You
            will see the exact amounts, and the result of simulating the transaction against
            mainnet, before Phantom asks you to approve anything.
            {!live.zcashPublishEnabled && (
              <>
                {" "}
                Zcash publication is off on this deployment, so a burn you make now will be a real
                burn with no stamp published yet: {live.publishBlockedReason}
              </>
            )}
          </Note>
        )}

        <Tech>
          <p className="tiny muted">
            Under the stamp: issuing creates a SOL-paired token on the venue and burns your whole
            allocation into the inscription. Supply and decimals come from the venue&apos;s
            published launch path, not from you.
          </p>
          <dl className="kv" style={{ marginTop: 10 }}>
            <dt>Decimals</dt>
            <dd className="mono">{parameters?.decimals ?? "—"}</dd>
            <dt>Supply (base)</dt>
            <dd className="mono">{parameters?.supplyBase ?? "—"}</dd>
            <dt>Pool (base)</dt>
            <dd className="mono">
              {parameters ? formatUnits(parameters.poolBase, parameters.decimals) : "—"}
            </dd>
            <dt>Quote mint</dt>
            <dd className="mono">{SOL_QUOTE.mint}</dd>
            <dt>Pairs source</dt>
            <dd className="mono">{(quote?.pairSource as string) || "—"}</dd>
          </dl>
        </Tech>
      </aside>
    </div>
  );
}
