import assert from "node:assert/strict";
import test from "node:test";
import { runBacktests, runRollingValidation } from "../src/lib/backtest.ts";

function makeCandles(length, closeAt) {
  const candles = [];
  let previousClose = closeAt(0);

  for (let index = 0; index < length; index += 1) {
    const close = closeAt(index);
    const open = previousClose;
    candles.push({
      openTime: index * 300_000,
      open,
      high: Math.max(open, close) + 1,
      low: Math.min(open, close) - 1,
      close,
      volume: 1,
      closeTime: (index + 1) * 300_000 - 1,
      quoteVolume: 1,
    });
    previousClose = close;
  }
  return candles;
}

const costs = {
  feeRate: 0.001,
  slippageRate: 0.0005,
  startingEquity: 100,
  riskPerTrade: 0.01,
  maxPositionFraction: 0.1,
};

test("splits chronologically and returns finite paper metrics", () => {
  const candles = makeCandles(1_000, (index) => 100 + 8 * Math.sin(index / 13) + index * 0.005);
  const reports = runBacktests(candles, costs);

  assert.deepEqual(reports.map((report) => report.name), ["EMA trend", "RSI mean reversion"]);
  for (const report of reports) {
    assert.deepEqual(report.splits.map((split) => split.split), ["train", "validation", "test"]);
    assert.equal(report.splits.reduce((sum, split) => sum + split.candles, 0), candles.length);
    for (const split of report.splits) {
      assert.ok(Number.isFinite(split.strategyReturnPct));
      assert.ok(Number.isFinite(split.buyAndHoldReturnPct));
      assert.ok(Number.isFinite(split.maxDrawdownPct));
      assert.ok(Number.isFinite(split.feesPaidUsd));
      assert.ok(Number.isFinite(split.turnoverUsd));
    }
  }
});

test("flat candles do not open positions and round-trip costs reduce the benchmark", () => {
  const candles = makeCandles(500, () => 100);
  const reports = runBacktests(candles, costs);

  for (const report of reports) {
    assert.equal(report.splits[0].tradeCount, 0);
    assert.equal(report.splits[0].strategyReturnPct, 0);
    assert.ok(report.splits[0].buyAndHoldReturnPct < 0);
    assert.equal(report.splits[0].feesPaidUsd, 0);
  }
});

test("no report is produced with too little candle history", () => {
  assert.throws(
    () => runBacktests(makeCandles(199, () => 100), costs),
    /At least 200 closed 5-minute candles/,
  );
});

test("rolling validation windows never include held-out test candles", () => {
  const candles = makeCandles(1_000, (index) => 100 + 8 * Math.sin(index / 13));
  const windows = runRollingValidation(candles, costs);
  assert.equal(windows.length, 4);
  for (let index = 0; index < windows.length; index += 1) {
    const window = windows[index];
    assert.equal(window.strategies.length, 2);
    assert.equal(window.historyEndTime, candles[600 + index * 50 - 1].closeTime);
    for (const { metrics } of window.strategies) {
      assert.equal(metrics.startTime, candles[600 + index * 50].openTime);
      assert.equal(metrics.endTime, candles[600 + (index + 1) * 50 - 1].closeTime);
      assert.equal(metrics.candles, 50);
      assert.ok(metrics.endTime < candles[800].openTime);
      assert.ok(Number.isFinite(metrics.strategyReturnPct));
    }
  }
  const mutatedTest = candles.map((candle, index) =>
    index < 800 ? candle : { ...candle, close: candle.close * 10 },
  );
  assert.deepEqual(runRollingValidation(mutatedTest, costs), windows);
});
