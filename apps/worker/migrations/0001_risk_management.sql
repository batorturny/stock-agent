-- Sector mapping
CREATE TABLE sectors (
  ticker TEXT PRIMARY KEY,
  sector TEXT NOT NULL, -- Technology, Healthcare, Financial, Consumer, Energy, Industrial, Communication, Utilities, RealEstate, Materials
  updated_at TEXT NOT NULL
);

-- Daily portfolio snapshots for equity curve
CREATE TABLE daily_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL UNIQUE,
  total_value REAL NOT NULL,
  cash REAL NOT NULL,
  invested REAL NOT NULL,
  positions_count INTEGER NOT NULL,
  spy_price REAL,
  daily_return_pct REAL,
  spy_return_pct REAL,
  peak_value REAL NOT NULL,
  drawdown_pct REAL NOT NULL DEFAULT 0,
  sharpe_30d REAL,
  created_at TEXT NOT NULL
);

-- AI prediction tracking
CREATE TABLE predictions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticker TEXT NOT NULL,
  entry_price REAL NOT NULL,
  target_price REAL NOT NULL,
  stop_loss REAL NOT NULL,
  confidence REAL NOT NULL,
  predicted_at TEXT NOT NULL,
  outcome TEXT, -- 'target_hit' | 'stop_hit' | 'expired' | 'pending'
  actual_price REAL,
  resolved_at TEXT,
  pnl_pct REAL
);

-- Pending limit orders
CREATE TABLE pending_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticker TEXT NOT NULL,
  action TEXT NOT NULL, -- buy | sell
  limit_price REAL NOT NULL,
  shares INTEGER NOT NULL,
  reason TEXT,
  expires_at TEXT NOT NULL,
  status TEXT DEFAULT 'pending', -- pending | filled | expired | cancelled
  created_at TEXT NOT NULL,
  filled_at TEXT
);

-- Earnings calendar cache
CREATE TABLE earnings_calendar (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticker TEXT NOT NULL,
  report_date TEXT NOT NULL,
  estimate_eps REAL,
  actual_eps REAL,
  status TEXT DEFAULT 'upcoming', -- upcoming | reported
  updated_at TEXT NOT NULL
);

-- Add new columns to trades table
ALTER TABLE trades ADD COLUMN trigger_type TEXT; -- 'ai_pick' | 'stop_loss' | 'take_profit' | 'news_reactive' | 'force_invest' | 'rebalance'
ALTER TABLE trades ADD COLUMN analysis_id INTEGER;
ALTER TABLE trades ADD COLUMN pre_cash REAL;
ALTER TABLE trades ADD COLUMN post_cash REAL;

CREATE INDEX idx_snapshots_date ON daily_snapshots(date);
CREATE INDEX idx_predictions_ticker ON predictions(ticker);
CREATE INDEX idx_predictions_outcome ON predictions(outcome);
CREATE INDEX idx_pending_orders_status ON pending_orders(status);
CREATE INDEX idx_earnings_ticker_date ON earnings_calendar(ticker, report_date);
