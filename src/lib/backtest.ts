export type Candle = {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
  quoteVolume: number;
};

export type BacktestCosts = {
  feeRate: number;
  slippageRate: number;
  startingEquity: number;
  riskPerTrade: number;
  maxPositionFraction: number;
};

type StrategyName = "EMA trend" | "RSI mean reversion";

type Trade = {
  entryTime: number;
  exitTime: number;
  netPnl: number;
  rMultiple: number;
  fees: number;
  turnover: number;
};

export type SplitMetrics = {
  split: "train" | "validation" | "test";
  startTime: number;
  endTime: number;
  candles: number;
  strategyReturnPct: number;
  buyAndHoldReturnPct: number;
  maxDrawdownPct: number;
  tradeCount: number;
  winRatePct: number;
  profitFactor: number | null;
  expectancyR: number | null;
  averageWinUsd: number | null;
  averageLossUsd: number | null;
  feesPaidUsd: number;
  turnoverUsd: number;
  exposurePct: number;
};

export type StrategyReport = {
  name: StrategyName;
  description: string;
  splits: SplitMetrics[];
};

export type RollingWindow = {
  window: number;
  historyStartTime: number;
  historyEndTime: number;
  marketReturnPct: number;
  regime: "up" | "down" | "sideways";
  strategies: Array<{ name: StrategyName; metrics: SplitMetrics }>;
};

const EMA_FAST_PERIOD = 12;
const EMA_SLOW_PERIOD = 26;
const RSI_PERIOD = 14;
const ATR_PERIOD = 14;
const STOP_ATR_MULTIPLE = 2;

function ema(values: number[], period: number): number[] {
  const alpha = 2 / (period + 1);
  const result = Array<number>(values.length);
  let previous = values[0] ?? 0;
  result[0] = previous;

  for (let index = 1; index < values.length; index += 1) {
    previous = values[index] * alpha + previous * (1 - alpha);
    result[index] = previous;
  }
  return result;
}

function rsi(values: number[], period: number): Array<number | null> {
  const result = Array<number | null>(values.length).fill(null);
  if (values.length <= period) return result;

  let averageGain = 0;
  let averageLoss = 0;
  for (let index = 1; index <= period; index += 1) {
    const change = values[index] - values[index - 1];
    averageGain += Math.max(change, 0);
    averageLoss += Math.max(-change, 0);
  }
  averageGain /= period;
  averageLoss /= period;
  result[period] = averageLoss === 0 ? 100 : 100 - 100 / (1 + averageGain / averageLoss);

  for (let index = period + 1; index < values.length; index += 1) {
    const change = values[index] - values[index - 1];
    averageGain = (averageGain * (period - 1) + Math.max(change, 0)) / period;
    averageLoss = (averageLoss * (period - 1) + Math.max(-change, 0)) / period;
    result[index] = averageLoss === 0 ? 100 : 100 - 100 / (1 + averageGain / averageLoss);
  }
  return result;
}

function atr(candles: Candle[], period: number): Array<number | null> {
  const result = Array<number | null>(candles.length).fill(null);
  if (candles.length <= period) return result;

  const trueRanges = candles.map((candle, index) => {
    if (index === 0) return candle.high - candle.low;
    const previousClose = candles[index - 1].close;
    return Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - previousClose),
      Math.abs(candle.low - previousClose),
    );
  });

  let average = trueRanges.slice(1, period + 1).reduce((sum, value) => sum + value, 0) / period;
  result[period] = average;
  for (let index = period + 1; index < candles.length; index += 1) {
    average = (average * (period - 1) + trueRanges[index]) / period;
    result[index] = average;
  }
  return result;
}

function strategySignals(candles: Candle[], strategy: StrategyName) {
  const closes = candles.map((candle) => candle.close);
  const averageTrueRange = atr(candles, ATR_PERIOD);

  if (strategy === "EMA trend") {
    const fast = ema(closes, EMA_FAST_PERIOD);
    const slow = ema(closes, EMA_SLOW_PERIOD);
    return candles.map((_, index) => ({
      enter:
        index > 0 &&
        fast[index - 1] <= slow[index - 1] &&
        fast[index] > slow[index],
      exit: index > 0 && fast[index - 1] >= slow[index - 1] && fast[index] < slow[index],
      stopDistance: averageTrueRange[index] === null ? null : averageTrueRange[index]! * STOP_ATR_MULTIPLE,
    }));
  }

  const strength = rsi(closes, RSI_PERIOD);
  return candles.map((_, index) => ({
    enter: strength[index] !== null && strength[index]! <= 30,
    exit: strength[index] !== null && strength[index]! >= 50,
    stopDistance: averageTrueRange[index] === null ? null : averageTrueRange[index]! * STOP_ATR_MULTIPLE,
  }));
}

function simulate(
  candles: Candle[],
  strategy: StrategyName,
  costs: BacktestCosts,
  split: SplitMetrics["split"],
  warmup: Candle[] = [],
): SplitMetrics {
  const signals = strategySignals([...warmup, ...candles], strategy).slice(warmup.length);
  const trades: Trade[] = [];
  let cash = costs.startingEquity;
  let quantity = 0;
  let stopPrice = 0;
  let entryCost = 0;
  let entryFees = 0;
  let entryRiskUsd = 0;
  let entryTime = 0;
  let pendingEntryStopDistance: number | null = null;
  let pendingExit = false;
  let feesPaidUsd = 0;
  let turnoverUsd = 0;
  let exposedBars = 0;
  let peakEquity = costs.startingEquity;
  let maxDrawdownPct = 0;

  function closePosition(referencePrice: number, exitTime: number) {
    const fillPrice = referencePrice * (1 - costs.slippageRate);
    const exitNotional = quantity * fillPrice;
    const exitFee = exitNotional * costs.feeRate;
    const netPnl = exitNotional - exitFee - entryCost - entryFees;

    cash += exitNotional - exitFee;
    feesPaidUsd += exitFee;
    turnoverUsd += exitNotional;
    trades.push({
      entryTime,
      exitTime,
      netPnl,
      rMultiple: entryRiskUsd > 0 ? netPnl / entryRiskUsd : 0,
      fees: entryFees + exitFee,
      turnover: entryCost + exitNotional,
    });

    quantity = 0;
    stopPrice = 0;
    entryCost = 0;
    entryFees = 0;
    entryRiskUsd = 0;
    entryTime = 0;
    pendingExit = false;
  }

  for (let index = 1; index < candles.length; index += 1) {
    const candle = candles[index];

    if (quantity > 0 && pendingExit) {
      closePosition(candle.open, candle.openTime);
    }

    if (quantity === 0 && pendingEntryStopDistance !== null) {
      const fillPrice = candle.open * (1 + costs.slippageRate);
      const proposedStop = candle.open - pendingEntryStopDistance;
      const riskPerUnit = fillPrice - proposedStop;

      if (riskPerUnit > 0 && proposedStop > 0) {
        const equityAtEntry = cash;
        const riskBudget = equityAtEntry * costs.riskPerTrade;
        const maxNotional = equityAtEntry * costs.maxPositionFraction;
        const riskSizedQuantity = riskBudget / riskPerUnit;
        const allocationSizedQuantity = maxNotional / fillPrice;
        const cashSizedQuantity = cash / (fillPrice * (1 + costs.feeRate));
        quantity = Math.min(riskSizedQuantity, allocationSizedQuantity, cashSizedQuantity);

        if (Number.isFinite(quantity) && quantity > 0) {
          entryCost = quantity * fillPrice;
          entryFees = entryCost * costs.feeRate;
          entryRiskUsd = quantity * riskPerUnit;
          entryTime = candle.openTime;
          stopPrice = proposedStop;
          cash -= entryCost + entryFees;
          feesPaidUsd += entryFees;
          turnoverUsd += entryCost;
        } else {
          quantity = 0;
        }
      }
      pendingEntryStopDistance = null;
    }

    if (quantity > 0 && candle.low <= stopPrice) {
      const stopFill = candle.open < stopPrice ? candle.open : stopPrice;
      closePosition(stopFill, candle.open < stopPrice ? candle.openTime : candle.closeTime);
    }

    const equity = cash + quantity * candle.close;
    peakEquity = Math.max(peakEquity, equity);
    if (peakEquity > 0) {
      maxDrawdownPct = Math.max(maxDrawdownPct, ((peakEquity - equity) / peakEquity) * 100);
    }
    if (quantity > 0) exposedBars += 1;

    const signal = signals[index];
    if (quantity > 0) {
      if (signal.exit) pendingExit = true;
    } else if (signal.enter && signal.stopDistance !== null) {
      pendingEntryStopDistance = signal.stopDistance;
    }
  }

  const lastCandle = candles[candles.length - 1];
  if (quantity > 0 && lastCandle) {
    closePosition(lastCandle.close, lastCandle.closeTime);
    peakEquity = Math.max(peakEquity, cash);
    if (peakEquity > 0) {
      maxDrawdownPct = Math.max(maxDrawdownPct, ((peakEquity - cash) / peakEquity) * 100);
    }
  }

  const endingEquity = cash;
  const strategyReturnPct = ((endingEquity - costs.startingEquity) / costs.startingEquity) * 100;
  const buyPrice = candles[0].open * (1 + costs.slippageRate);
  const buyQuantity = costs.startingEquity / (buyPrice * (1 + costs.feeRate));
  const sellPrice = lastCandle.close * (1 - costs.slippageRate);
  const sellNotional = buyQuantity * sellPrice;
  const sellFee = sellNotional * costs.feeRate;
  const benchmarkEquity = sellNotional - sellFee;
  const buyAndHoldReturnPct =
    ((benchmarkEquity - costs.startingEquity) / costs.startingEquity) * 100;

  const winningTrades = trades.filter((trade) => trade.netPnl > 0);
  const losingTrades = trades.filter((trade) => trade.netPnl < 0);
  const grossWins = winningTrades.reduce((sum, trade) => sum + trade.netPnl, 0);
  const grossLosses = Math.abs(losingTrades.reduce((sum, trade) => sum + trade.netPnl, 0));
  const profitFactor =
    grossLosses > 0 ? grossWins / grossLosses : winningTrades.length > 0 ? null : 0;

  return {
    split,
    startTime: candles[0].openTime,
    endTime: lastCandle.closeTime,
    candles: candles.length,
    strategyReturnPct,
    buyAndHoldReturnPct,
    maxDrawdownPct,
    tradeCount: trades.length,
    winRatePct: trades.length > 0 ? (winningTrades.length / trades.length) * 100 : 0,
    profitFactor,
    expectancyR:
      trades.length > 0
        ? trades.reduce((sum, trade) => sum + trade.rMultiple, 0) / trades.length
        : null,
    averageWinUsd:
      winningTrades.length > 0 ? grossWins / winningTrades.length : null,
    averageLossUsd:
      losingTrades.length > 0 ? -grossLosses / losingTrades.length : null,
    feesPaidUsd,
    turnoverUsd,
    exposurePct: candles.length > 0 ? (exposedBars / candles.length) * 100 : 0,
  };
}

function evaluateStrategy(
  candles: Candle[],
  strategy: StrategyName,
  costs: BacktestCosts,
): StrategyReport {
  const trainEnd = Math.floor(candles.length * 0.6);
  const validationEnd = Math.floor(candles.length * 0.8);
  const splits = [
    { split: "train" as const, data: candles.slice(0, trainEnd) },
    { split: "validation" as const, data: candles.slice(trainEnd, validationEnd) },
    { split: "test" as const, data: candles.slice(validationEnd) },
  ];

  return {
    name: strategy,
    description:
      strategy === "EMA trend"
        ? "Long-only 12/26 EMA crossover; exits on reverse crossover or a 2× ATR stop."
        : "Long-only RSI(14) entry at or below 30; exits at or above 50 or a 2× ATR stop.",
    splits: splits.map(({ split, data }) => simulate(data, strategy, costs, split)),
  };
}

export function runBacktests(candles: Candle[], costs: BacktestCosts): StrategyReport[] {
  if (candles.length < 200) {
    throw new Error("At least 200 closed 5-minute candles are required for this exploratory report.");
  }

  const minimumSplitSize = Math.floor(candles.length * 0.2);
  if (minimumSplitSize < 50) {
    throw new Error("Each chronological validation split must contain at least 50 candles.");
  }

  return [
    evaluateStrategy(candles, "EMA trend", costs),
    evaluateStrategy(candles, "RSI mean reversion", costs),
  ];
}

export function runRollingValidation(candles: Candle[], costs: BacktestCosts): RollingWindow[] {
  if (candles.length < 200) {
    throw new Error("At least 200 closed 5-minute candles are required for rolling validation.");
  }
  const start = Math.floor(candles.length * 0.6);
  const end = Math.floor(candles.length * 0.8);
  const count = 4;
  return Array.from({ length: count }, (_, index) => {
    const windowStart = start + Math.floor((end - start) * index / count);
    const windowEnd = start + Math.floor((end - start) * (index + 1) / count);
    const prior = candles.slice(0, windowStart);
    const windowCandles = candles.slice(windowStart, windowEnd);
    const marketReturnPct = (windowCandles[windowCandles.length - 1].close / windowCandles[0].open - 1) * 100;
    return {
      window: index + 1,
      historyStartTime: prior[0].openTime,
      historyEndTime: prior[prior.length - 1].closeTime,
      marketReturnPct,
      regime: marketReturnPct > 2 ? "up" : marketReturnPct < -2 ? "down" : "sideways",
      strategies: (["EMA trend", "RSI mean reversion"] as StrategyName[]).map((name) => ({
        name,
        metrics: simulate(windowCandles, name, costs, "validation", prior),
      })),
    };
  });
}
