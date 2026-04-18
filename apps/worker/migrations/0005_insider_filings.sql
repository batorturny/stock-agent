-- Insider filings from SEC EDGAR Form 4 / Finnhub insider-transactions
CREATE TABLE IF NOT EXISTS insider_filings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticker TEXT NOT NULL,
  filer_name TEXT NOT NULL,
  filer_role TEXT NOT NULL,
  transaction_type TEXT NOT NULL,
  shares REAL NOT NULL,
  price_per_share REAL,
  total_value REAL,
  transaction_date TEXT NOT NULL,
  filing_date TEXT NOT NULL,
  filing_url TEXT,
  source TEXT NOT NULL DEFAULT 'finnhub',
  fetched_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_insider_ticker ON insider_filings(ticker);
CREATE INDEX IF NOT EXISTS idx_insider_date ON insider_filings(transaction_date);
CREATE INDEX IF NOT EXISTS idx_insider_type ON insider_filings(transaction_type);

-- Detected insider trading signals (cluster buys, CEO buys, etc.)
CREATE TABLE IF NOT EXISTS insider_signals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticker TEXT NOT NULL,
  signal_type TEXT NOT NULL,
  insider_count INTEGER NOT NULL,
  total_value REAL NOT NULL,
  confidence REAL NOT NULL,
  details TEXT NOT NULL,
  acted_on INTEGER DEFAULT 0,
  detected_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_signal_ticker ON insider_signals(ticker);
CREATE INDEX IF NOT EXISTS idx_signal_type ON insider_signals(signal_type);
