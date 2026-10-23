/**
 * The one demand-forecasting engine every dashboard section reads from -
 * function #3 (monthly demand), function #2 (revenue, same math over
 * revenue instead of units), and function #1 (restock, over a daily
 * bucket instead of monthly) all call `forecast()` below. There is
 * deliberately no separate "restock forecast" calculation - see
 * src/lib/forecast/restock.ts, which consumes this module's output
 * rather than recomputing demand itself.
 *
 * Swapping the method is a config change, not a UI change: every caller
 * goes through `forecast()`, which dispatches on `options.method`. A new
 * method is a new case in `fitMethod()` below plus an entry in
 * `ForecastMethod`; nothing in src/app or src/lib/forecast/data.ts needs
 * to change.
 *
 * Method choice: sales history here is a few thousand order lines total
 * across all stores - far too little for a seasonal or ML model to fit
 * reliably (seasonality needs multiple full cycles of history; we don't
 * have even one full year yet). Holt's linear exponential smoothing
 * (level + trend, no seasonal component) is the default: simple,
 * explainable, and it degrades sensibly on short series. A plain moving
 * average is offered as the even-simpler fallback. FLAGGED: neither
 * method models seasonality - once >=24 months of history exist, revisit
 * with a seasonal method (e.g. Holt-Winters) rather than silently
 * pretending the current trend line captures seasonal swings it can't.
 */

export interface Period {
  /** Bucket start date, "YYYY-MM-DD". */
  date: string;
  value: number;
}

export interface FittedPoint {
  date: string;
  actual: number;
  /** The model's in-sample smoothed level at this point - the "trend line" shown alongside the forecast. */
  level: number;
}

export interface ForecastPoint {
  date: string;
  expected: number;
  low: number;
  high: number;
}

export type ForecastMethod = "sma" | "holt";

export const DEFAULT_METHOD: ForecastMethod = "holt";

export interface ForecastOptions {
  /** How many periods ahead to project, in the same bucket size as the input series. */
  horizon: number;
  method?: ForecastMethod;
  /** Band half-width in residual std-deviations. ~1.28 = 80% CI (default), ~1.645 = 90%. Approximate: residuals from a handful of low-volume periods aren't reliably normal, so treat the band as indicative, not a precise interval. */
  confidenceZ?: number;
  /** Window size for method: "sma". Default 3. */
  smaWindow?: number;
  /** Level smoothing constant for method: "holt", 0-1. Default 0.4. */
  alpha?: number;
  /** Trend smoothing constant for method: "holt", 0-1. Default 0.2. */
  beta?: number;
}

export interface ForecastResult {
  method: ForecastMethod;
  /** True if the series was too short for the requested method and a simpler fallback was used instead. */
  usedFallback: boolean;
  fitted: FittedPoint[];
  forecast: ForecastPoint[];
  /** RMSE of one-step-ahead in-sample errors - the basis for the forecast band, and a rough accuracy signal on its own. */
  residualStdDev: number;
}

const DEFAULT_Z = 1.28; // ~80% CI for a normal distribution
const DEFAULT_SMA_WINDOW = 3;
const DEFAULT_ALPHA = 0.4;
const DEFAULT_BETA = 0.2;

/** Simple moving average: level = mean of the trailing window. No trend component. */
function fitSma(values: number[], window: number): number[] {
  return values.map((_, i) => {
    const start = Math.max(0, i - window + 1);
    const slice = values.slice(start, i + 1);
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  });
}

/** Holt's linear exponential smoothing: a level + a trend, both smoothed. */
function fitHolt(
  values: number[],
  alpha: number,
  beta: number,
): { fitted: number[]; level: number; trend: number } {
  let level = values[0];
  let trend = values.length > 1 ? values[1] - values[0] : 0;
  const fitted: number[] = [level];

  for (let i = 1; i < values.length; i++) {
    const prevLevel = level;
    level = alpha * values[i] + (1 - alpha) * (prevLevel + trend);
    trend = beta * (level - prevLevel) + (1 - beta) * trend;
    fitted.push(level);
  }

  return { fitted, level, trend };
}

function addPeriods(dateStr: string, count: number, bucketDays: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + count * bucketDays);
  return d.toISOString().slice(0, 10);
}

/** Detects the bucket size (in days) from the gap between the last two periods, so forecast dates step forward consistently whether the caller passed daily, weekly, or monthly buckets. Falls back to 30 (monthly) for a single-point series. */
function inferBucketDays(history: Period[]): number {
  if (history.length < 2) return 30;
  const a = new Date(`${history[history.length - 2].date}T00:00:00Z`).getTime();
  const b = new Date(`${history[history.length - 1].date}T00:00:00Z`).getTime();
  return Math.max(1, Math.round((b - a) / (24 * 60 * 60 * 1000)));
}

export function forecast(
  history: Period[],
  options: ForecastOptions,
): ForecastResult {
  const method = options.method ?? DEFAULT_METHOD;
  const z = options.confidenceZ ?? DEFAULT_Z;
  const horizon = Math.max(0, options.horizon);
  const bucketDays = inferBucketDays(history);

  if (history.length === 0) {
    return { method, usedFallback: false, fitted: [], forecast: [], residualStdDev: 0 };
  }

  const values = history.map((p) => p.value);
  // Holt needs at least 2 points to seed a trend - fall back to SMA below that.
  const usedFallback = method === "holt" && values.length < 2;
  const effectiveMethod: ForecastMethod = usedFallback ? "sma" : method;

  let fittedValues: number[];
  let projectNext: (stepsAhead: number) => number;

  if (effectiveMethod === "sma") {
    const window = options.smaWindow ?? DEFAULT_SMA_WINDOW;
    fittedValues = fitSma(values, window);
    const lastLevel = fittedValues[fittedValues.length - 1];
    projectNext = () => lastLevel; // flat projection - no trend in a plain SMA
  } else {
    const alpha = options.alpha ?? DEFAULT_ALPHA;
    const beta = options.beta ?? DEFAULT_BETA;
    const { fitted, level, trend } = fitHolt(values, alpha, beta);
    fittedValues = fitted;
    projectNext = (stepsAhead: number) => level + stepsAhead * trend;
  }

  const fittedPoints: FittedPoint[] = history.map((p, i) => ({
    date: p.date,
    actual: p.value,
    level: fittedValues[i],
  }));

  // One-step-ahead in-sample residuals: fitted[i] was computed using data
  // through i, so comparing it to actual[i] slightly overstates fit
  // quality (it's not a true holdout), but it's the standard cheap proxy
  // and matches what a moving-average/exponential-smoothing model can
  // offer without a proper backtest split on data this thin.
  const residuals = fittedValues.map((f, i) => values[i] - f).slice(1); // skip the unavoidable first-point residual of 0
  const residualStdDev =
    residuals.length > 0
      ? Math.sqrt(residuals.reduce((sum, e) => sum + e * e, 0) / residuals.length)
      : 0;

  const lastDate = history[history.length - 1].date;
  const forecastPoints: ForecastPoint[] = [];
  for (let h = 1; h <= horizon; h++) {
    const expected = Math.max(0, projectNext(h));
    // Uncertainty grows with the sqrt of the horizon (a standard random-walk
    // approximation), so a forecast 6 periods out has a wider band than
    // next period's.
    const spread = z * residualStdDev * Math.sqrt(h);
    forecastPoints.push({
      date: addPeriods(lastDate, h, bucketDays),
      expected,
      low: Math.max(0, expected - spread),
      high: expected + spread,
    });
  }

  return {
    method: effectiveMethod,
    usedFallback,
    fitted: fittedPoints,
    forecast: forecastPoints,
    residualStdDev,
  };
}

/** Sums per-period values across whatever dimension the caller grouped rows by (store, category, SKU, ...) into a single series - the shared building block behind every rollup in data.ts. */
export function sumSeries(seriesList: Period[][]): Period[] {
  const byDate = new Map<string, number>();
  for (const series of seriesList) {
    for (const p of series) {
      byDate.set(p.date, (byDate.get(p.date) ?? 0) + p.value);
    }
  }
  return Array.from(byDate.entries())
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, value]) => ({ date, value }));
}
