"use client";

import { useEffect, useState } from "react";

type Symbol = "BTCUSDT" | "ETHUSDT" | "SOLUSDT";
type Interval = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";
type Bar = {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closed: boolean;
};
type ChartData = {
  symbol: Symbol;
  interval: Interval;
  receivedAt: number;
  candles: Bar[];
};

const money = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const symbols: Symbol[] = ["BTCUSDT", "ETHUSDT", "SOLUSDT"];
const intervals: Interval[] = ["1m", "5m", "15m", "1h", "4h", "1d"];

function isChartData(value: unknown, symbol: Symbol, interval: Interval): value is ChartData {
  if (typeof value !== "object" || value === null) return false;
  const data = value as Partial<ChartData>;
  return data.symbol === symbol && data.interval === interval &&
    typeof data.receivedAt === "number" && Number.isFinite(data.receivedAt) &&
    Array.isArray(data.candles) && data.candles.length > 0 &&
    data.candles.every((bar: Bar) =>
      typeof bar === "object" && bar !== null &&
      [bar.openTime, bar.open, bar.high, bar.low, bar.close, bar.volume].every(
        (value) => typeof value === "number" && Number.isFinite(value),
      ) && typeof bar.closed === "boolean",
    );
}

function CandlePlot({ candles, symbol, interval }: { candles: Bar[]; symbol: Symbol; interval: Interval }) {
  const width = 800;
  const height = 250;
  const top = 10;
  const bottom = 225;
  const high = Math.max(...candles.map((bar) => bar.high));
  const low = Math.min(...candles.map((bar) => bar.low));
  const padding = Math.max((high - low) * 0.06, high * 0.0001);
  const ceiling = high + padding;
  const floor = low - padding;
  const y = (price: number) => top + (ceiling - price) / (ceiling - floor) * (bottom - top);
  const step = width / candles.length;

  return (
    <svg
      className="candle-svg"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`${symbol.replace("USDT", "/USDT")} ${interval} candlestick chart, ${candles.length} candles. Green indicates price rose; red indicates it fell.`}
    >
      {[0, 1, 2, 3].map((line) => {
        const position = top + (bottom - top) * line / 3;
        return <line key={line} x1="0" x2={width} y1={position} y2={position} stroke="#e9ede9" strokeWidth="1" />;
      })}
      {candles.map((bar, index) => {
        const x = step * (index + 0.5);
        const color = bar.close >= bar.open ? "#2aa979" : "#df7474";
        const bodyTop = Math.min(y(bar.open), y(bar.close));
        const bodyHeight = Math.max(1.5, Math.abs(y(bar.open) - y(bar.close)));
        return (
          <g key={bar.openTime}>
            <line x1={x} x2={x} y1={y(bar.high)} y2={y(bar.low)} stroke={color} strokeWidth="1.5" />
            <rect x={x - step * 0.32} y={bodyTop} width={Math.max(1, step * 0.64)} height={bodyHeight} fill={color} />
          </g>
        );
      })}
    </svg>
  );
}

export default function CandlestickChart() {
  const [symbol, setSymbol] = useState<Symbol>("BTCUSDT");
  const [interval, setIntervalValue] = useState<Interval>("5m");
  const [data, setData] = useState<ChartData | null>(null);
  const [error, setError] = useState("");
  const [selectedTime, setSelectedTime] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    let timer: number | undefined;
    const controller = new AbortController();
    async function refresh() {
      try {
        const params = new URLSearchParams({ symbol, interval, limit: "100" });
        const response = await fetch(`/api/candles?${params}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload: unknown = await response.json();
        if (!response.ok) {
          const message = typeof payload === "object" && payload !== null && "error" in payload &&
            typeof payload.error === "string" ? payload.error : `Candle request failed (${response.status}).`;
          throw new Error(message);
        }
        if (!isChartData(payload, symbol, interval)) throw new Error("The candle endpoint returned invalid data.");
        if (active) {
          setData(payload);
          setError("");
        }
      } catch (caught) {
        if (active) setError(caught instanceof Error ? caught.message : "Candlestick data is unavailable.");
      } finally {
        if (active) timer = window.setTimeout(refresh, 15_000);
      }
    }
    void refresh();
    return () => {
      active = false;
      controller.abort();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [symbol, interval]);

  const current = data?.symbol === symbol && data.interval === interval ? data : null;
  const latest = current?.candles[current.candles.length - 1];
  const selectedIndex = current && selectedTime !== null
    ? current.candles.findIndex((bar) => bar.openTime === selectedTime) : -1;
  const selected = current?.candles[selectedIndex >= 0 ? selectedIndex : current.candles.length - 1];
  return (
    <section className="panel candle-panel" aria-label="MEXC candlestick chart">
      <div className="candle-heading">
        <div><div className="section-kicker">PUBLIC EXCHANGE DATA</div><h2>Price chart</h2></div>
        <div className="candle-controls">
          <label>Market
            <select value={symbol} onChange={(event) => { setError(""); setSelectedTime(null); setSymbol(event.target.value as Symbol); }}>
              {symbols.map((item) => <option key={item} value={item}>{item.replace("USDT", "/USDT")}</option>)}
            </select>
          </label>
          <label>Interval
            <select value={interval} onChange={(event) => { setError(""); setSelectedTime(null); setIntervalValue(event.target.value as Interval); }}>
              {intervals.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
        </div>
      </div>
      <p className={`market-refresh-note ${error ? "market-refresh-error" : ""}`} role="status">
        {error ? `${error}${current ? ` Showing last update from ${new Date(current.receivedAt).toLocaleTimeString()}.` : ""}`
          : current ? `MEXC spot · refreshed ${new Date(current.receivedAt).toLocaleTimeString()} · about every 15 seconds`
            : "Loading public candle data…"}
      </p>
      {current && latest && selected ? (
        <>
          <div className="candle-ohlc">
            <strong>{symbol.replace("USDT", "/USDT")}</strong>
            <span>O {money.format(selected.open)}</span><span>H {money.format(selected.high)}</span>
            <span>L {money.format(selected.low)}</span><span>C {money.format(selected.close)}</span>
            <span>{new Date(selected.openTime).toLocaleString()} · {selected.closed ? "Closed" : "Still forming"}</span>
          </div>
          <div className="candle-plot">
            <div className="candle-prices"><span>{money.format(Math.max(...current.candles.map((bar) => bar.high)))}</span><span>{money.format(Math.min(...current.candles.map((bar) => bar.low)))}</span></div>
            <CandlePlot candles={current.candles} symbol={symbol} interval={interval} />
          </div>
          <div className="candle-times">
            <span>{new Date(current.candles[0].openTime).toLocaleString()}</span>
            <span>{new Date(latest.openTime).toLocaleString()}</span>
          </div>
          <label className="candle-scrubber">
            <span>Inspect candle {selectedIndex >= 0 ? selectedIndex + 1 : current.candles.length} of {current.candles.length}</span>
            <input type="range" min="0" max={current.candles.length - 1}
              value={selectedIndex >= 0 ? selectedIndex : current.candles.length - 1}
              onChange={(event) => {
                const index = Number(event.target.value);
                setSelectedTime(index === current.candles.length - 1 ? null : current.candles[index].openTime);
              }} />
          </label>
        </>
      ) : <div className="market-empty">{error ? "No candle data available." : "Waiting for MEXC candles…"}</div>}
      <p className="candle-note">Public snapshots, not executable prices. The latest candle may change until it closes.</p>
    </section>
  );
}
