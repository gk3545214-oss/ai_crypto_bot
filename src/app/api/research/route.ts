import { createHash } from "node:crypto";
import { connection } from "next/server";
import { runBacktests, runRollingValidation, type BacktestCosts, type Candle } from "@/lib/backtest";

const MEXC_KLINES_URL = "https://api.mexc.com/api/v3/klines";
const SYMBOL = "BTCUSDT";
const INTERVAL = "5m";
const INTERVAL_MS = 5 * 60 * 1000;
const MAX_CANDLES_PER_REQUEST = 500;
const HISTORY_DAYS = 90;
const REQUEST_TIMEOUT_MS = 10_000;
const DATASET_CACHE_TTL_MS = 5 * 60 * 1000;

type CandleDataset = {
  candles: Candle[];
  startTime: number;
  endTime: number;
  sha256: string;
  quality: ReturnType<typeof dataQuality>;
  fetchedAt: number;
};

let candleDatasetCache: CandleDataset | null = null;

function readNumber(value: unknown, field: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`MEXC returned an invalid ${field}`);
  }
  return parsed;
}

function parseCandle(row: unknown): Candle {
  if (!Array.isArray(row) || row.length < 8) {
    throw new Error("MEXC returned a malformed candle.");
  }

  const candle: Candle = {
    openTime: readNumber(row[0], "candle open time"),
    open: readNumber(row[1], "candle open"),
    high: readNumber(row[2], "candle high"),
    low: readNumber(row[3], "candle low"),
    close: readNumber(row[4], "candle close"),
    volume: readNumber(row[5], "candle volume"),
    closeTime: readNumber(row[6], "candle close time"),
    quoteVolume: readNumber(row[7], "candle quote volume"),
  };

  if (
    candle.openTime <= 0 ||
    candle.closeTime < candle.openTime ||
    candle.open <= 0 ||
    candle.high <= 0 ||
    candle.low <= 0 ||
    candle.close <= 0 ||
    candle.high < candle.low
  ) {
    throw new Error("MEXC returned an invalid candle.");
  }
  return candle;
}

async function fetchCandlePage(startTime: number, endTime: number): Promise<Candle[]> {
  const url = new URL(MEXC_KLINES_URL);
  url.searchParams.set("symbol", SYMBOL);
  url.searchParams.set("interval", INTERVAL);
  url.searchParams.set("startTime", String(startTime));
  url.searchParams.set("endTime", String(endTime));
  url.searchParams.set("limit", String(MAX_CANDLES_PER_REQUEST));

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(url, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (response.ok) {
      const payload: unknown = await response.json();
      if (!Array.isArray(payload)) {
        throw new Error("MEXC returned an invalid candle-data response.");
      }
      return payload.map(parseCandle);
    }

    if (response.status !== 429 && response.status < 500) {
      throw new Error(`MEXC candle request failed with HTTP ${response.status}`);
    }
    if (attempt === 2) {
      throw new Error(`MEXC candle request failed with HTTP ${response.status} after retries`);
    }
    await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
  }

  throw new Error("MEXC candle request failed after retries.");
}

async function loadCandles(startTime: number, endTime: number, now: number) {
  const pageRanges: Array<{ start: number; end: number }> = [];
  for (
    let pageStart = startTime;
    pageStart <= endTime;
    pageStart += MAX_CANDLES_PER_REQUEST * INTERVAL_MS
  ) {
    pageRanges.push({
      start: pageStart,
      end: Math.min(
        endTime,
        pageStart + MAX_CANDLES_PER_REQUEST * INTERVAL_MS - 1,
      ),
    });
  }

  const candles: Candle[] = [];
  for (let index = 0; index < pageRanges.length; index += 2) {
    const pageBatch = pageRanges.slice(index, index + 2);
    const pages = await Promise.all(
      pageBatch.map(({ start, end }) => fetchCandlePage(start, end)),
    );
    candles.push(...pages.flat());
  }

  const deduplicated = new Map<number, Candle>();
  for (const candle of candles) {
    if (
      candle.openTime >= startTime &&
      candle.openTime <= endTime &&
      candle.closeTime < now
    ) {
      deduplicated.set(candle.openTime, candle);
    }
  }

  return [...deduplicated.values()].sort((first, second) => first.openTime - second.openTime);
}

function dataQuality(candles: Candle[]) {
  let gapCount = 0;
  for (let index = 1; index < candles.length; index += 1) {
    const distance = candles[index].openTime - candles[index - 1].openTime;
    if (distance > INTERVAL_MS) {
      gapCount += Math.max(0, Math.round(distance / INTERVAL_MS) - 1);
    }
  }

  const first = candles[0];
  const last = candles[candles.length - 1];
  const expected =
    first && last
      ? Math.floor((last.openTime - first.openTime) / INTERVAL_MS) + 1
      : 0;

  return {
    gapCount,
    observedCandles: candles.length,
    expectedCandlesBetweenFirstAndLast: expected,
    coveragePct: expected > 0 ? (candles.length / expected) * 100 : 0,
  };
}

export async function POST(request: Request) {
  await connection();

  let requestBody: unknown;
  try {
    requestBody = await request.json();
  } catch {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  if (typeof requestBody !== "object" || requestBody === null) {
    return Response.json({ error: "Backtest settings are required." }, { status: 400 });
  }

  const body = requestBody as Record<string, unknown>;
  const feePercent = readUserPercent(body.feePercent);
  const slippagePercent = readUserPercent(body.slippagePercent);
  if (feePercent === null || slippagePercent === null) {
    return Response.json(
      { error: "Fee and slippage must be numbers between 0 and 5 percent per side." },
      { status: 400 },
    );
  }

  const now = Date.now();
  const requestedStart = now - HISTORY_DAYS * 24 * 60 * 60 * 1000;
  const startTime = Math.floor(requestedStart / INTERVAL_MS) * INTERVAL_MS;
  const endTime = Math.floor(now / INTERVAL_MS) * INTERVAL_MS - 1;
  const costs: BacktestCosts = {
    feeRate: feePercent / 100,
    slippageRate: slippagePercent / 100,
    startingEquity: 100,
    riskPerTrade: 0.01,
    maxPositionFraction: 0.1,
  };

  try {
    let dataset = candleDatasetCache;
    if (!dataset || now - dataset.fetchedAt >= DATASET_CACHE_TTL_MS) {
      const candles = await loadCandles(startTime, endTime, now);
      if (candles.length < 200) {
        throw new Error(`Only ${candles.length} closed candles were returned; at least 200 are required.`);
      }

      const quality = dataQuality(candles);
      if (quality.gapCount > 0) {
        throw new Error(
          `Backtest refused: MEXC history has ${quality.gapCount} missing 5-minute candles and ${quality.coveragePct.toFixed(2)}% interval coverage.`,
        );
      }

      dataset = {
        candles,
        startTime: candles[0].openTime,
        endTime: candles[candles.length - 1].closeTime,
        sha256: createHash("sha256")
          .update(
            candles
              .map((candle) =>
                [
                  candle.openTime,
                  candle.open,
                  candle.high,
                  candle.low,
                  candle.close,
                  candle.volume,
                  candle.closeTime,
                  candle.quoteVolume,
                ].join(","),
              )
              .join("\n"),
          )
          .digest("hex"),
        quality,
        fetchedAt: Date.now(),
      };
      candleDatasetCache = dataset;
    }

    return Response.json(
      {
        source: "MEXC Spot API",
        symbol: SYMBOL,
        interval: INTERVAL,
        historyDaysRequested: HISTORY_DAYS,
        generatedAt: Date.now(),
        datasetFetchedAt: dataset.fetchedAt,
        dataset: {
          startTime: dataset.startTime,
          endTime: dataset.endTime,
          sha256: dataset.sha256,
          quality: dataset.quality,
        },
        assumptions: {
          ...costs,
          feeBasis: "per side",
          slippageBasis: "per side",
          splitMethod: "chronological 60% train / 20% validation / 20% test",
          fillTiming: "signal at candle close, simulated fill at next candle open",
          stopLoss: "2 × ATR(14)",
          maxConcurrentPositions: 1,
          leverage: 1,
          note: "Exploratory paper backtest only; not evidence that a strategy is profitable or ready for live orders.",
        },
        strategies: runBacktests(dataset.candles, costs),
        rollingValidation: runRollingValidation(dataset.candles, costs),
        candles: dataset.candles,
      },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  } catch (error) {
    console.error("Unable to run the BTC paper research backtest", error);
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to retrieve candle data or run the paper backtest.",
      },
      { status: 502, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }
}

function readUserPercent(value: unknown): number | null {
  if (
    (typeof value !== "number" && typeof value !== "string") ||
    (typeof value === "string" && value.trim() === "")
  ) {
    return null;
  }
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 5 ? parsed : null;
}
