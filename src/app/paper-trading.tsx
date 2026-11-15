"use client";

import { useEffect, useState } from "react";

type Fill = {
  request_id: string;
  side: "buy" | "sell";
  quantity: string;
  price: string;
  fee: string;
  created_at: number;
};
type Account = { usdt: string; btc: string; fills: Fill[] };
type Order = { requestId: string; side: "buy" | "sell"; quantity: string };
const pendingKey = "aster-pending-paper-order";

function isAccount(value: unknown): value is Account {
  if (typeof value !== "object" || value === null) return false;
  const account = value as Partial<Account>;
  return typeof account.usdt === "string" && Number.isFinite(Number(account.usdt)) &&
    typeof account.btc === "string" && Number.isFinite(Number(account.btc)) && Array.isArray(account.fills);
}

function errorText(value: unknown, fallback: string) {
  return typeof value === "object" && value !== null && "error" in value && typeof value.error === "string"
    ? value.error : fallback;
}

function newId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export default function PaperTrading() {
  const [account, setAccount] = useState<Account | null>(null);
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [quantity, setQuantity] = useState("");
  const [pending, setPending] = useState<Order | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const saved = localStorage.getItem(pendingKey);
        if (saved) {
          const parsed: unknown = JSON.parse(saved);
          if (typeof parsed !== "object" || parsed === null || !("requestId" in parsed) ||
              typeof parsed.requestId !== "string" || !("side" in parsed) ||
              (parsed.side !== "buy" && parsed.side !== "sell") ||
              !("quantity" in parsed) || typeof parsed.quantity !== "string") {
            throw new Error("Stored pending paper order is invalid. Clear this site's browser storage only after checking order history.");
          }
          if (active) setPending({ requestId: parsed.requestId, side: parsed.side, quantity: parsed.quantity });
        }
        const response = await fetch("/api/paper", { cache: "no-store" });
        const result: unknown = await response.json();
        if (!response.ok || !isAccount(result)) throw new Error(errorText(result, "Paper account is unavailable."));
        if (active) setAccount(result);
      } catch (caught) {
        if (active) setError(caught instanceof Error ? caught.message : "Paper account is unavailable.");
      }
    }
    void load();
    return () => { active = false; };
  }, []);

  async function submit() {
    setBusy(true);
    setError("");
    setNotice("");
    let order = pending;
    try {
      if (!order) {
        order = { requestId: newId(), side, quantity };
        localStorage.setItem(pendingKey, JSON.stringify(order));
        setPending(order);
      }
      const response = await fetch("/api/paper/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(order),
      });
      const result: unknown = await response.json();
      if (!response.ok) {
        if (response.status >= 400 && response.status < 500) {
          localStorage.removeItem(pendingKey);
          setPending(null);
        }
        throw new Error(errorText(result, `Paper order failed (${response.status}).`));
      }
      if (!isAccount(result)) throw new Error("Invalid order response; retry the same paper request.");
      localStorage.removeItem(pendingKey);
      setPending(null);
      setAccount(result);
      setQuantity("");
      setNotice("Simulated order recorded. No exchange order was sent.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Paper order failed. Retry the same request.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel paper-panel" aria-label="Manual paper trading">
      <div className="panel-heading">
        <div><div className="section-kicker">PERSISTENT SIMULATION · BTC/USDT</div><h2>Paper trading</h2></div>
        <span className="research-badge">SIMULATED ONLY</span>
      </div>
      <p className="research-intro">Manual simulated market fills use a fresh MEXC bid/ask snapshot, not an actual order book. No exchange account or live orders are connected.</p>
      {account ? (
        <div className="paper-balances">
          <div><span>Paper USDT</span><strong>{Number(account.usdt).toFixed(4)}</strong></div>
          <div><span>Paper BTC</span><strong>{Number(account.btc).toFixed(8)}</strong></div>
        </div>
      ) : <p className="market-refresh-note">Paper account not loaded.</p>}
      <div className="paper-form">
        <label className="research-input"><span>Side</span>
          <select value={pending?.side ?? side} disabled={busy || !!pending} onChange={(event) => setSide(event.target.value === "sell" ? "sell" : "buy")}>
            <option value="buy">Buy BTC</option><option value="sell">Sell BTC</option>
          </select>
        </label>
        <label className="research-input"><span>BTC quantity</span>
          <input type="number" min="0.00000001" step="0.00000001" inputMode="decimal" value={pending?.quantity ?? quantity}
            disabled={busy || !!pending} onChange={(event) => setQuantity(event.target.value)} />
        </label>
        <button className="research-run-button" type="button" disabled={busy || !account || (!pending && (!quantity || Number(quantity) <= 0))}
          onClick={() => void submit()}>
          {busy ? "Submitting…" : pending ? "Retry same paper order" : "Place simulated order"}
        </button>
      </div>
      <p className="research-assumptions">Starts with 100 paper USDT. Buys are capped at 10% of paper equity; no leverage or short selling. Each fill assumes 0.10% fee and 0.05% additional slippage; these are not verified MEXC rates. No automatic stop loss is provided.</p>
      {pending && <p className="research-assumptions">A previous request may have completed. Retry the same order safely; its request ID prevents duplicate fills.</p>}
      {error && <div className="research-error" role="alert">{error}</div>}
      {notice && <p role="status" className="paper-success">{notice}</p>}
      {account && account.fills.length > 0 && (
        <div className="research-table-wrap">
          <table className="research-table">
            <thead><tr><th>Paper fill</th><th>Time</th><th>BTC</th><th>Price (USDT)</th><th>Fee (USDT)</th></tr></thead>
            <tbody>{account.fills.map((fill) => (
              <tr key={fill.request_id}><td>{fill.side.toUpperCase()}</td><td>{new Date(fill.created_at).toLocaleString()}</td>
                <td>{Number(fill.quantity).toFixed(8)}</td><td>{Number(fill.price).toFixed(2)}</td><td>{Number(fill.fee).toFixed(6)}</td></tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}
