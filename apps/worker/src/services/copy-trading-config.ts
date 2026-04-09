// Tracked politicians for copy trading
// delayHours: how long to wait before executing the copy trade (legal buffer)
// positionSizePct: % of portfolio cash to allocate per copy trade
// trackedTickers: pre-seed symbols to check for this politician (empty = check all)

export interface TrackedPolitician {
  namePart: string;       // partial name match (case-insensitive)
  displayName: string;    // shown in UI
  party: "D" | "R" | "I";
  position: "Senator" | "Representative";
  delayHours: number;
  positionSizePct: number; // 1–10 (%)
  trackedTickers: string[];
}

export const COPY_TRADING_CONFIG: TrackedPolitician[] = [
  {
    namePart: "Pelosi",
    displayName: "Nancy Pelosi",
    party: "D",
    position: "Representative",
    delayHours: 24,
    positionSizePct: 5,
    trackedTickers: ["NVDA", "AAPL", "MSFT", "GOOGL", "AMZN", "META", "TSLA"],
  },
  {
    namePart: "McCaul",
    displayName: "Michael McCaul",
    party: "R",
    position: "Representative",
    delayHours: 24,
    positionSizePct: 3,
    trackedTickers: ["NVDA", "AAPL", "MSFT", "AMD", "INTC", "QCOM"],
  },
  {
    namePart: "Tuberville",
    displayName: "Tommy Tuberville",
    party: "R",
    position: "Senator",
    delayHours: 24,
    positionSizePct: 3,
    trackedTickers: ["NVDA", "AAPL", "MSFT", "META", "GOOGL"],
  },
];
