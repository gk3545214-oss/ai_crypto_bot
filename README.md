# Aster paper-trading prototype

An iPhone-first Next.js dashboard prototype for the crypto trading platform in
the developer handoff. A FastAPI service reads public MEXC spot tickers and
candles for BTC/USDT, ETH/USDT, and SOL/USDT. A separate local paper account
simulates manual BTC/USDT orders. The other dashboard balances, positions,
activity, and controls remain fictional demo data. The app does not connect to
an exchange account or wallet and cannot place live orders.

## Run locally

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.txt
.venv/bin/python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

In a second terminal:

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in a browser.
Both processes must be running. Next.js proxies market requests server-side to
FastAPI at `http://127.0.0.1:8000` by default, so the iPhone browser does not
need direct access to the backend. Set `FASTAPI_BASE_URL` on the **Next.js
server** when FastAPI is hosted separately; keep that backend on a private
network or behind appropriate access controls. Research remains in Next.js.
To run focused tests:

```bash
.venv/bin/python -m unittest discover -s tests -p 'test_*backend.py'
npm run test:backtest
```

## Add to an iPhone home screen

Deploy the app to an HTTPS host, open its URL in Safari on iPhone, then choose
**Share → Add to Home Screen**. The app manifest provides the standalone display
mode and theme color. The demo currently requires a network connection; it does
not cache trading controls or account data for offline use.

## Safety and scope

- Public ticker data comes from the
  [MEXC Spot API 24-hour ticker endpoint](https://mexcdevelop.github.io/apidocs/spot_v3_en/#24hr-ticker-price-change-statistics).
  The page requests updates about every 15 seconds. These are public 24-hour
  ticker snapshots, not a streaming order book or a guarantee of executable
  prices.
- The candlestick chart displays the latest 100 public MEXC candles, offers
  market and interval selection, and refreshes about every 15 seconds. The
  newest candle may still be forming; a failed refresh is identified as stale.
  The chart slider lets users inspect individual candle OHLC data.
  FastAPI exposes read-only `/api/market` and `/api/candles` endpoints and
  validates supported symbols, intervals, and input data. `/health` is a
  process-health check, not an exchange connectivity check.
- **Strategy research** fetches closed 5-minute BTC/USDT candles for the
  preceding 90 days from MEXC and compares a 12/26 EMA crossover with an
  RSI(14) mean-reversion baseline. It uses chronological 60/20/20
  train/validation/test splits and simulates signal fills at the next candle
  open. Entry/exit fees and slippage, ATR stops, and position-risk caps are
  applied in the simulator only.
- Candle history is paginated in 500-record requests, validated for interval
  continuity, and cached in memory for five minutes. Research fails closed
  rather than reporting results if any 5-minute intervals are missing.
- Research results can be downloaded with the candle inputs and SHA-256 data
  hash, time range, and coverage; the fee/slippage defaults are assumptions
  from the handoff, not a confirmed MEXC fee schedule.
- Four fixed-parameter rolling validation windows cover the middle 20% of the
  data. Indicators warm up using preceding candles; each window starts with
  fresh capital and closes any position at its end. Post-hoc market regimes
  describe each window's return. This is not parameter fitting or a complete
  walk-forward optimization, and the final 20% is excluded from these windows.
- The manual paper account starts with 100 simulated USDT and supports BTC/USDT
  only. It stores balances and fills in `data/paper.sqlite3` (override the path
  with `ASTER_PAPER_DB`); back up this file if the history matters. It uses
  fresh MEXC bid/ask snapshots, assumes 0.10% fees and 0.05% additional
  slippage per side, rejects quotes older than 30 seconds, limits total BTC
  allocation to 10% of post-fill paper equity, and disallows short selling.
  Fill prices and liquidity are only approximations; there is no automatic
  paper stop loss. Request IDs make retries idempotent and simulated fills are
  committed atomically. The browser retains an uncertain request for retry.
- The paper account is a single shared local account with **no authentication**.
  Keep both services local and do not expose them to untrusted networks or the
  public internet. Authentication, authorization, CSRF and deployment hardening
  are required before shared or remote use.
- The 90-day comparison is exploratory, not a complete walk-forward/regime
  validation and not proof of positive expectancy. No strategy is connected to
  an autonomous engine or live order endpoint.
- The prototype has no exchange account credentials or authenticated trading
  API.
- There is no wallet signing, seed phrase handling, withdrawal, or transfer
  functionality.
- The separate demo UI toggles, positions, balances, and stop controls only
  change or display local demo state; they are not connected to the paper
  account or a bot.
- Live order submission is intentionally not implemented or enabled. The
  handoff's backtest, paper-trading, risk, security, and explicit-approval gates
  must be completed before any live trading work.
- Do not use the sample figures as account data or performance claims.

The handoff's historical Colab notebook and two cited GitHub repositories still
need to be made accessible before the prior strategies and backtests can be
audited. Autonomous paper strategies, cloud services, authentication, private
account data, and live order execution are not implemented.
