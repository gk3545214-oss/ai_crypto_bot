"use client";

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import type { Candle, RollingWindow, SplitMetrics, StrategyReport } from "@/lib/backtest";
import CandlestickChart from "./candlestick-chart";
import PaperTrading from "./paper-trading";

type LiveTicker = {
  symbol: string;
  lastPrice: number;
  changePercent: number;
  highPrice: number;
  lowPrice: number;
  bidPrice: number;
  askPrice: number;
  quoteVolume: number;
  exchangeTime: number;
};

type MarketDataResponse = {
  source?: string;
  receivedAt?: number;
  tickers?: LiveTicker[];
  error?: string;
};

type ResearchResult = {
  source: string;
  symbol: string;
  interval: string;
  historyDaysRequested: number;
  generatedAt: number;
  dataset: {
    startTime: number;
    endTime: number;
    sha256: string;
    quality: {
      gapCount: number;
      observedCandles: number;
      expectedCandlesBetweenFirstAndLast: number;
      coveragePct: number;
    };
  };
  assumptions: {
    feeRate: number;
    slippageRate: number;
    startingEquity: number;
    riskPerTrade: number;
    maxPositionFraction: number;
    feeBasis: string;
    slippageBasis: string;
    splitMethod: string;
    fillTiming: string;
    stopLoss: string;
    maxConcurrentPositions: number;
    leverage: number;
    note: string;
  };
  strategies: StrategyReport[];
  rollingValidation: RollingWindow[];
  candles: Candle[];
};

type Market = {
  symbol: string;
  name: string;
  amount: string;
  value: string;
  change: string;
  positive: boolean;
  color: string;
  glyph: string;
};

const markets: Market[] = [
  {
    symbol: "BTC",
    name: "Bitcoin",
    amount: "0.0842 BTC",
    value: "$5,627.40",
    change: "+4.28%",
    positive: true,
    color: "#f7931a",
    glyph: "₿",
  },
  {
    symbol: "ETH",
    name: "Ethereum",
    amount: "1.42 ETH",
    value: "$3,844.20",
    change: "+2.16%",
    positive: true,
    color: "#8292f4",
    glyph: "◆",
  },
  {
    symbol: "SOL",
    name: "Solana",
    amount: "18.6 SOL",
    value: "$2,905.80",
    change: "−1.08%",
    positive: false,
    color: "#9b82f3",
    glyph: "≋",
  },
];

const activity = [
  { title: "Paper buy filled", detail: "BTC / USDT · 0.002 BTC", time: "10:42 AM", kind: "buy" },
  { title: "Risk check passed", detail: "Position size within demo limit", time: "10:18 AM", kind: "check" },
  { title: "Paper sell filled", detail: "ETH / USDT · 0.05 ETH", time: "Yesterday", kind: "sell" },
];

const priceFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatCompactUsd(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatPercent(value: number) {
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatReportMetric(value: number | null, digits = 2) {
  return value === null ? "—" : value.toFixed(digits);
}

function isResearchResult(payload: unknown): payload is ResearchResult {
  if (typeof payload !== "object" || payload === null) return false;
  const result = payload as Partial<ResearchResult>;
  return (
    typeof result.symbol === "string" &&
    typeof result.dataset?.sha256 === "string" &&
    Array.isArray(result.strategies) &&
    Array.isArray(result.rollingValidation) &&
    Array.isArray(result.candles)
  );
}

function getErrorMessage(payload: unknown, fallback: string) {
  if (typeof payload === "object" && payload !== null && "error" in payload) {
    const error = (payload as { error?: unknown }).error;
    if (typeof error === "string") return error;
  }
  return fallback;
}

function TrendChart() {
  return (
    <svg
      className="equity-chart"
      viewBox="0 0 640 174"
      role="img"
      aria-label="Illustrative demo equity chart trending upward"
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id="chartFill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#b9f1d8" stopOpacity=".56" />
          <stop offset="100%" stopColor="#b9f1d8" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path
        d="M0 137 C25 135 28 118 54 123 S83 144 106 126 S134 119 156 111 S184 123 206 105 S235 111 258 94 S290 101 311 87 S341 99 365 79 S394 91 417 67 S447 80 469 60 S495 74 518 50 S548 67 568 39 S601 54 640 18 L640 174 L0 174 Z"
        fill="url(#chartFill)"
      />
      <path
        d="M0 137 C25 135 28 118 54 123 S83 144 106 126 S134 119 156 111 S184 123 206 105 S235 111 258 94 S290 101 311 87 S341 99 365 79 S394 91 417 67 S447 80 469 60 S495 74 518 50 S548 67 568 39 S601 54 640 18"
        fill="none"
        stroke="#2aa979"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <circle cx="640" cy="18" r="5" fill="#2aa979" />
    </svg>
  );
}

function Sparkline({ positive }: { positive: boolean }) {
  return (
    <svg className="sparkline" viewBox="0 0 76 30" aria-hidden="true">
      <path
        d={
          positive
            ? "M1 22 C9 18 10 23 17 16 S27 19 34 12 S44 15 50 9 S61 14 75 4"
            : "M1 7 C9 10 10 6 17 12 S27 9 34 16 S44 12 50 19 S61 17 75 25"
        }
        fill="none"
        stroke={positive ? "#2aa979" : "#df7474"}
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <svg viewBox="0 0 32 32" fill="none">
        <path d="M7 22.5 16 6l9 16.5h-5.3L16 13.2l-3.8 9.3H7Z" fill="currentColor" />
        <path d="M12.1 22.5h7.8" stroke="#f4fbf7" strokeWidth="2" strokeLinecap="round" />
      </svg>
    </span>
  );
}

function NavIcon({ name }: { name: "grid" | "chart" | "clock" | "settings" }) {
  const paths = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
    chart: <><path d="M3 17.5 8.5 12l4 3.5L21 6" /><path d="M15 6h6v6" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.5 2" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="m19.4 15 .1.1 1.4 1.1-1.4 2.4-1.7-.7a8 8 0 0 1-1.8 1l-.3 1.8h-2.8l-.3-1.8a8 8 0 0 1-1.8-1l-1.7.7-1.4-2.4 1.4-1.1a7 7 0 0 1 0-2l-1.4-1.1 1.4-2.4 1.7.7a8 8 0 0 1 1.8-1l.3-1.8h2.8l.3 1.8a8 8 0 0 1 1.8 1l1.7-.7 1.4 2.4-1.4 1.1a7 7 0 0 1 0 2Z" transform="translate(-1 -1) scale(1.08)" /></>,
  };

  return (
    <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

export default function Home() {
  const [liveTickers, setLiveTickers] = useState<LiveTicker[]>([]);
  const [marketStatus, setMarketStatus] = useState<"connecting" | "live" | "error">("connecting");
  const [marketUpdatedAt, setMarketUpdatedAt] = useState<number | null>(null);
  const [marketError, setMarketError] = useState("");
  const [researchLoading, setResearchLoading] = useState(false);
  const [researchError, setResearchError] = useState("");
  const [researchResult, setResearchResult] = useState<ResearchResult | null>(null);
  const [feePercent, setFeePercent] = useState("0.10");
  const [slippagePercent, setSlippagePercent] = useState("0.05");
  const [paperRunning, setPaperRunning] = useState(false);
  const [mexcEnabled, setMexcEnabled] = useState(false);
  const [solanaEnabled, setSolanaEnabled] = useState(false);
  const [stoppedMarkets, setStoppedMarkets] = useState<string[]>([]);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    async function refreshMarketData() {
      try {
        const response = await fetch("/api/market", { cache: "no-store" });
        const result = (await response.json()) as MarketDataResponse;
        if (!response.ok || !result.tickers || !result.receivedAt) {
          throw new Error(result.error ?? "MEXC market data is unavailable.");
        }

        if (!cancelled) {
          setLiveTickers(result.tickers);
          setMarketUpdatedAt(result.receivedAt);
          setMarketStatus("live");
          setMarketError("");
        }
      } catch (error) {
        if (!cancelled) {
          setMarketStatus("error");
          setMarketError(error instanceof Error ? error.message : "MEXC market data is unavailable.");
        }
      } finally {
        if (!cancelled) {
          timer = window.setTimeout(refreshMarketData, 15_000);
        }
      }
    }

    void refreshMarketData();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, []);

  function showDemoNotice(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 3200);
  }

  function toggleMarket(symbol: string) {
    const isStopped = stoppedMarkets.includes(symbol);
    setStoppedMarkets((current) =>
      isStopped ? current.filter((market) => market !== symbol) : [...current, symbol],
    );
    showDemoNotice(`${symbol} ${isStopped ? "resumed" : "paused"} in this local demo only.`);
  }

  async function runPaperResearch() {
    setResearchLoading(true);
    setResearchError("");
    setResearchResult(null);

    try {
      const response = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          feePercent: Number(feePercent),
          slippagePercent: Number(slippagePercent),
        }),
      });
      const payload: unknown = await response.json();

      if (!response.ok) {
        throw new Error(getErrorMessage(payload, `Research request failed (${response.status}).`));
      }
      if (!isResearchResult(payload)) {
        throw new Error("The research endpoint returned an invalid report.");
      }
      setResearchResult(payload);
    } catch (error) {
      setResearchError(error instanceof Error ? error.message : "Unable to run the paper backtest.");
    } finally {
      setResearchLoading(false);
    }
  }

  function downloadResearchArchive() {
    if (!researchResult) return;
    const archive = new Blob([JSON.stringify(researchResult, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(archive);
    const link = document.createElement("a");
    link.href = url;
    link.download = `mexc-${researchResult.symbol.toLowerCase()}-${researchResult.interval}-research-${new Date(researchResult.generatedAt).toISOString().slice(0, 10)}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#overview" aria-label="Aster overview">
          <BrandMark />
          <span>aster<span className="brand-period">.</span></span>
        </a>
        <div className="sidebar-caption">WORKSPACE</div>
        <nav className="side-nav" aria-label="Main navigation">
          <a className="nav-link active" href="#overview"><NavIcon name="grid" />Overview</a>
          <a className="nav-link" href="#portfolio"><NavIcon name="chart" />Portfolio</a>
          <a className="nav-link" href="#research"><NavIcon name="chart" />Research</a>
          <a className="nav-link" href="#activity"><NavIcon name="clock" />Activity</a>
          <a className="nav-link" href="#settings"><NavIcon name="settings" />Settings</a>
        </nav>
        <div className="sidebar-bottom">
          <div className="security-note">
            <span className="security-icon">✳</span>
            <strong>Protected by design</strong>
            <p>Withdrawals are never available in this app.</p>
          </div>
          <div className="profile">
            <span className="avatar">JD</span>
            <span className="profile-copy"><strong>Jordan Davis</strong><small>Demo workspace</small></span>
            <span className="profile-menu" aria-hidden="true">···</span>
          </div>
        </div>
      </aside>

      <div className="main-column">
        <header className="topbar">
          <div className="breadcrumb"><span>Workspace</span><span className="breadcrumb-slash">/</span><strong>Overview</strong></div>
          <div className="topbar-actions">
            <span className={`environment-badge ${marketStatus === "error" ? "market-error" : ""}`}>
              <span />{marketStatus === "live" ? "MEXC PUBLIC DATA" : marketStatus === "error" ? "DATA UNAVAILABLE" : "CONNECTING TO MEXC"}
            </span>
            <button className="help-button" type="button" onClick={() => showDemoNotice("This is a local-only prototype. No account is connected.")}>?</button>
            <span className="top-avatar">JD</span>
          </div>
        </header>

        <main className="dashboard" id="overview">
          <section className="welcome-row">
            <div>
              <div className="eyebrow"><span className="eyebrow-dot" />SUNDAY, NOVEMBER 15</div>
              <h1>Good morning, Jordan<span className="wave">✳</span></h1>
              <p className="welcome-subtitle">A clear view of your paper portfolio.</p>
            </div>
            <button
              className={`primary-action ${paperRunning ? "is-running" : ""}`}
              type="button"
              onClick={() => {
                setPaperRunning((running) => !running);
                showDemoNotice(`Paper bot ${paperRunning ? "stopped" : "started"} in this local demo only.`);
              }}
            >
              <span className="play-symbol">{paperRunning ? "Ⅱ" : "▶"}</span>
              {paperRunning ? "Stop paper demo" : "Start paper demo"}
            </button>
          </section>

          <section className="demo-banner" aria-label="Live data and paper-order notice">
            <span className="demo-banner-icon">!</span>
            <div><strong>Live public prices · live orders disabled</strong><span>MEXC public spot data is read-only. No account, API key, wallet, or trading permission is connected.</span></div>
            <span className="demo-banner-tag">READ ONLY</span>
          </section>

          <section className="panel live-market-panel" aria-label="Live MEXC spot prices">
            <div className="panel-heading">
              <div><div className="section-kicker">PUBLIC EXCHANGE DATA</div><h2>MEXC spot markets</h2></div>
              <span className={`feed-status ${marketStatus === "live" ? "feed-live" : marketStatus === "error" ? "feed-error" : ""}`}>
                <span />{marketStatus === "live" ? "Live" : marketStatus === "error" ? "Unavailable" : "Connecting"}
              </span>
            </div>
            <p className={`market-refresh-note ${marketStatus === "error" ? "market-refresh-error" : ""}`}>
              {marketStatus === "live" && marketUpdatedAt
                ? `24-hour ticker · refreshed ${new Date(marketUpdatedAt).toLocaleTimeString()} · about every 15 seconds`
                : marketStatus === "error"
                  ? `${marketError}${marketUpdatedAt ? ` Last successful update: ${new Date(marketUpdatedAt).toLocaleTimeString()}.` : ""}`
                  : "Connecting to MEXC public market data…"}
            </p>
            {liveTickers.length > 0 ? (
              <div className="live-market-grid">
                {liveTickers.map((ticker) => (
                  <article className="live-market-card" key={ticker.symbol}>
                    <div className="live-market-pair">
                      <strong>{ticker.symbol.replace("USDT", "")}<span>/ USDT</span></strong>
                      <span>MEXC</span>
                    </div>
                    <div className="live-market-price">{priceFormatter.format(ticker.lastPrice)}</div>
                    <span className={`live-market-change ${ticker.changePercent >= 0 ? "positive-text" : "negative-text"}`}>
                      {formatPercent(ticker.changePercent)} <span>24h</span>
                    </span>
                    <div className="live-market-meta">
                      <span>24h high <strong>{priceFormatter.format(ticker.highPrice)}</strong></span>
                      <span>24h low <strong>{priceFormatter.format(ticker.lowPrice)}</strong></span>
                      <span>24h volume <strong>{formatCompactUsd(ticker.quoteVolume)}</strong></span>
                    </div>
                  </article>
                ))}
              </div>
            ) : marketStatus === "error" ? (
              <div className="market-empty" role="status">No live prices are shown. Sample portfolio figures below are not current exchange prices.</div>
            ) : null}
          </section>

          <CandlestickChart />

          <PaperTrading />

          <section className="metric-grid" aria-label="Demo account summary">
            <article className="metric-card equity-card">
              <div className="metric-heading"><span>Total demo equity</span><span className="metric-menu">···</span></div>
              <div className="equity-value">$12,840<span>.00</span></div>
              <div className="equity-change"><span>↗</span> $184.24 <span className="muted">(+1.46%) this week</span></div>
              <div className="chart-wrap"><TrendChart /></div>
              <div className="chart-labels"><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span><span>Sun</span></div>
            </article>
            <article className="metric-card small-metric">
              <div className="metric-heading"><span>Available balance</span><span className="metric-icon balance-icon">$</span></div>
              <div className="small-value">$4,462<span>.60</span></div>
              <div className="metric-footnote">Demo USDT balance</div>
              <div className="metric-divider" />
              <div className="mini-meta"><span>In open positions</span><strong>$8,377.40</strong></div>
            </article>
            <article className="metric-card small-metric">
              <div className="metric-heading"><span>Today&apos;s P&amp;L</span><span className="metric-icon pnl-icon">↗</span></div>
              <div className="small-value positive-value">+$42<span>.18</span></div>
              <div className="metric-footnote positive-text">+0.33% <span className="muted">vs. yesterday</span></div>
              <div className="metric-divider" />
              <div className="mini-meta"><span>Max drawdown</span><strong className="neutral-value">−2.4%</strong></div>
            </article>
          </section>

          <section className="content-grid">
            <article className="panel portfolio-panel" id="portfolio">
              <div className="panel-heading">
                <div><div className="section-kicker">DEMO ACCOUNT</div><h2>Portfolio</h2></div>
                <button className="subtle-button" type="button" onClick={() => showDemoNotice("Portfolio values are illustrative sample data.")}>View details <span>↗</span></button>
              </div>
              <div className="allocation-total"><strong>$12,377.40</strong><span>Across 3 sample assets</span></div>
              <div className="allocation-bar" aria-label="Sample allocation: 45 percent Bitcoin, 31 percent Ethereum, 24 percent Solana">
                <span className="alloc-btc" /><span className="alloc-eth" /><span className="alloc-sol" />
              </div>
              <div className="asset-list">
                {markets.map((market) => (
                  <div className="asset-row" key={market.symbol}>
                    <span className="coin-icon" style={{ "--coin-color": market.color } as CSSProperties}>{market.glyph}</span>
                    <span className="asset-name"><strong>{market.symbol}</strong><small>{market.name}</small></span>
                    <span className="asset-spark"><Sparkline positive={market.positive} /></span>
                    <span className="asset-value"><strong>{market.value}</strong><small>{market.amount}</small></span>
                    <span className={`asset-change ${market.positive ? "positive-text" : "negative-text"}`}>{market.change}</span>
                  </div>
                ))}
              </div>
            </article>

            <article className="panel control-panel" id="settings">
              <div className="panel-heading">
                <div><div className="section-kicker">LOCAL DEMO CONTROLS</div><h2>Trading modules</h2></div>
                <span className={`bot-state ${paperRunning ? "state-on" : ""}`}><span />{paperRunning ? "Demo running" : "Demo paused"}</span>
              </div>
              <p className="panel-description">Toggle sample module states. These controls do not connect to a venue.</p>
              <div className="module-row">
                <span className="module-logo mexc-logo">M</span>
                <span className="module-copy"><strong>MEXC</strong><small>Spot · paper mode only</small></span>
                <button className={`switch ${mexcEnabled ? "switch-on" : ""}`} type="button" role="switch" aria-checked={mexcEnabled} aria-label={`${mexcEnabled ? "Disable" : "Enable"} MEXC paper demo`} onClick={() => { setMexcEnabled((enabled) => !enabled); showDemoNotice("MEXC toggle changed in this local demo only."); }}><span /></button>
              </div>
              <div className="module-row">
                <span className="module-logo solana-logo">≋</span>
                <span className="module-copy"><strong>Solana DEX</strong><small>Dedicated wallet · demo only</small></span>
                <button className={`switch ${solanaEnabled ? "switch-on" : ""}`} type="button" role="switch" aria-checked={solanaEnabled} aria-label={`${solanaEnabled ? "Disable" : "Enable"} Solana paper demo`} onClick={() => { setSolanaEnabled((enabled) => !enabled); showDemoNotice("Solana toggle changed in this local demo only."); }}><span /></button>
              </div>
              <div className="risk-note"><span>✓</span><p><strong>Risk controls are illustrative.</strong> No orders are submitted and no funds are accessible.</p></div>
              <button className="kill-switch" type="button" onClick={() => { setPaperRunning(false); setMexcEnabled(false); setSolanaEnabled(false); showDemoNotice("Demo controls reset. No live system was connected."); }}><span className="kill-icon">■</span>Reset demo controls</button>
            </article>
          </section>

          <section className="panel positions-panel">
            <div className="panel-heading positions-heading">
              <div><div className="section-kicker">SAMPLE POSITIONS</div><h2>Open positions <span className="count-pill">3</span></h2></div>
              <span className="table-note">Sample data · not account balances</span>
            </div>
            <div className="position-table">
              <div className="position-head"><span>ASSET</span><span>ENTRY PRICE</span><span>MARK PRICE</span><span>UNREALIZED P&amp;L</span><span>MARKET</span></div>
              {markets.map((market, index) => {
                const isStopped = stoppedMarkets.includes(market.symbol);
                const entry = ["$64,280.00", "$2,640.50", "$153.20"][index];
                const mark = ["$66,835.00", "$2,707.18", "$150.62"][index];
                const pnl = ["+$215.14", "+$94.66", "−$48.02"][index];
                return (
                  <div className={`position-row ${isStopped ? "position-stopped" : ""}`} key={market.symbol}>
                    <span className="position-asset"><span className="coin-icon small-coin" style={{ "--coin-color": market.color } as CSSProperties}>{market.glyph}</span><strong>{market.symbol}<small> / USDT</small></strong></span>
                    <span>{entry}</span><span>{mark}</span>
                    <span className={market.positive ? "positive-text" : "negative-text"}>{pnl}</span>
                    <button className={`market-control ${isStopped ? "market-stopped" : ""}`} type="button" onClick={() => toggleMarket(market.symbol)} aria-label={`${isStopped ? "Resume" : "Pause"} ${market.symbol} demo market`}>{isStopped ? "Paused" : "Pause"} <span>{isStopped ? "↻" : "Ⅱ"}</span></button>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="panel research-panel" id="research">
            <div className="panel-heading">
              <div><div className="section-kicker">PAPER-ONLY · BTC/USDT · 5-MINUTE</div><h2>Strategy research</h2></div>
              <span className="research-badge">NO ORDERS</span>
            </div>
            <p className="research-intro">
              Compare two simple long-only baselines on closed MEXC candles. Signals use a next-candle-open fill, fees and slippage are charged on entry and exit, and the final 20% is held out as a test split.
            </p>
            <div className="research-settings">
              <label className="research-input">
                <span>Fee per side (%)</span>
                <input
                  type="number"
                  min="0"
                  max="5"
                  step="0.01"
                  value={feePercent}
                  onChange={(event) => setFeePercent(event.target.value)}
                />
              </label>
              <label className="research-input">
                <span>Slippage per side (%)</span>
                <input
                  type="number"
                  min="0"
                  max="5"
                  step="0.01"
                  value={slippagePercent}
                  onChange={(event) => setSlippagePercent(event.target.value)}
                />
              </label>
              <button
                className="research-run-button"
                type="button"
                disabled={
                  researchLoading ||
                  feePercent.trim() === "" ||
                  slippagePercent.trim() === "" ||
                  Number(feePercent) < 0 ||
                  Number(feePercent) > 5 ||
                  Number(slippagePercent) < 0 ||
                  Number(slippagePercent) > 5
                }
                onClick={() => void runPaperResearch()}
              >
                {researchLoading ? "Fetching candles and testing…" : researchResult ? "Run again" : "Run paper research"}
              </button>
            </div>
            <p className="research-assumptions">
              Defaults are the unverified fee/slippage assumptions from the handoff. The simulator starts with $100 paper equity, risks at most 1% per trade, caps position value at 10% of equity, uses a 2× ATR stop, and does not use leverage.
            </p>
            {researchError && <div className="research-error" role="alert">{researchError}</div>}
            {researchLoading && (
              <div className="research-progress" role="status">
                Downloading up to 90 days of public candle history from MEXC. Live trading remains disabled.
              </div>
            )}
            {researchResult && (
              <div className="research-report">
                <div className="report-summary">
                  <div>
                    <strong>Archived input dataset</strong>
                    <span>
                      {researchResult.dataset.quality.observedCandles.toLocaleString()} candles ·{" "}
                      {researchResult.dataset.quality.gapCount.toLocaleString()} gaps ·{" "}
                      {researchResult.dataset.quality.coveragePct.toFixed(2)}% interval coverage
                    </span>
                    <span>
                      {new Date(researchResult.dataset.startTime).toLocaleString()} –{" "}
                      {new Date(researchResult.dataset.endTime).toLocaleString()}
                    </span>
                    <code>SHA-256 {researchResult.dataset.sha256}</code>
                  </div>
                  <button className="subtle-button archive-button" type="button" onClick={downloadResearchArchive}>
                    Download report + candles <span>↓</span>
                  </button>
                </div>
                <p className="report-warning">
                  Exploratory only. This 90-day comparison is not a full walk-forward or regime validation and is not approval for live orders.
                </p>
                <div className="research-table-wrap">
                  <table className="research-table">
                    <thead>
                      <tr>
                        <th>Strategy</th>
                        <th>Split</th>
                        <th>Net return</th>
                        <th>Buy &amp; hold</th>
                        <th>Max DD</th>
                        <th>Trades</th>
                        <th>Win rate</th>
                        <th>Profit factor</th>
                        <th>Expectancy (R)</th>
                        <th>Fees</th>
                        <th>Avg win / loss</th>
                        <th>Exposure</th>
                      </tr>
                    </thead>
                    <tbody>
                      {researchResult.strategies.flatMap((strategy) =>
                        strategy.splits.map((split: SplitMetrics) => (
                          <tr key={`${strategy.name}-${split.split}`}>
                            <td><strong>{strategy.name}</strong></td>
                            <td>{split.split}</td>
                            <td className={split.strategyReturnPct >= 0 ? "positive-text" : "negative-text"}>{formatPercent(split.strategyReturnPct)}</td>
                            <td>{formatPercent(split.buyAndHoldReturnPct)}</td>
                            <td>{split.maxDrawdownPct.toFixed(2)}%</td>
                            <td>{split.tradeCount}</td>
                            <td>{split.winRatePct.toFixed(1)}%</td>
                            <td>{split.profitFactor === null ? "∞" : split.profitFactor.toFixed(2)}</td>
                            <td>{formatReportMetric(split.expectancyR)}</td>
                            <td>{priceFormatter.format(split.feesPaidUsd)}</td>
                            <td>{split.averageWinUsd === null ? "—" : priceFormatter.format(split.averageWinUsd)} / {split.averageLossUsd === null ? "—" : priceFormatter.format(split.averageLossUsd)}</td>
                            <td>{split.exposurePct.toFixed(1)}%</td>
                          </tr>
                        )),
                      )}
                    </tbody>
                  </table>
                </div>
                <h3 className="rolling-heading">Rolling validation windows</h3>
                <p className="report-footnote">
                  Four non-overlapping windows cover the middle 20% only; indicators use earlier candles for warm-up. Each window starts with fresh paper capital and positions are closed at its end. Strategies and parameters are fixed, not trained or optimized. Regimes use each window&apos;s realized market return: above +2% up, below −2% down, otherwise sideways. The final 20% is not used in these windows.
                </p>
                <div className="research-table-wrap">
                  <table className="research-table">
                    <thead><tr><th>Window</th><th>Period</th><th>Regime</th><th>Market return</th><th>Strategy</th><th>Net return</th><th>Trades</th><th>Max DD</th></tr></thead>
                    <tbody>
                      {researchResult.rollingValidation.flatMap((window) => window.strategies.map(({ name, metrics }) => (
                        <tr key={`${window.window}-${name}`}>
                          <td>{window.window}</td>
                          <td>{new Date(metrics.startTime).toLocaleDateString()} – {new Date(metrics.endTime).toLocaleDateString()}</td>
                          <td>{window.regime}</td><td>{formatPercent(window.marketReturnPct)}</td>
                          <td>{name}</td><td>{formatPercent(metrics.strategyReturnPct)}</td>
                          <td>{metrics.tradeCount}</td><td>{metrics.maxDrawdownPct.toFixed(2)}%</td>
                        </tr>
                      )))}
                    </tbody>
                  </table>
                </div>
                <p className="report-footnote">
                  Generated {new Date(researchResult.generatedAt).toLocaleString()} · chronological 60/20/20 train/validation/test · file archive includes the candle inputs and all assumptions for reproduction.
                </p>
              </div>
            )}
          </section>

          <section className="panel activity-panel" id="activity">
            <div className="panel-heading">
              <div><div className="section-kicker">PAPER LOG</div><h2>Recent activity</h2></div>
              <button className="subtle-button" type="button" onClick={() => showDemoNotice("Activity is sample data for this prototype.")}>Full history <span>↗</span></button>
            </div>
            <div className="activity-list">
              {activity.map((item) => (
                <div className="activity-row" key={`${item.title}-${item.time}`}>
                  <span className={`activity-icon activity-${item.kind}`}>{item.kind === "check" ? "✓" : item.kind === "buy" ? "↙" : "↗"}</span>
                  <span className="activity-copy"><strong>{item.title}</strong><small>{item.detail}</small></span>
                  <span className="activity-time">{item.time}</span>
                </div>
              ))}
            </div>
          </section>
          <footer className="page-footer"><span>ASTER · PROTOTYPE</span><span>Portfolio figures are fictional; MEXC market cards use public data.</span></footer>
        </main>
      </div>

      <nav className="mobile-nav" aria-label="Mobile navigation">
        <a className="mobile-nav-link selected" href="#overview"><NavIcon name="grid" /><span>Home</span></a>
        <a className="mobile-nav-link" href="#portfolio"><NavIcon name="chart" /><span>Portfolio</span></a>
        <a className="mobile-nav-link" href="#activity"><NavIcon name="clock" /><span>Activity</span></a>
        <a className="mobile-nav-link" href="#settings"><NavIcon name="settings" /><span>Settings</span></a>
      </nav>

      {notice && <div className="demo-toast" role="status">{notice}</div>}
    </div>
  );
}
