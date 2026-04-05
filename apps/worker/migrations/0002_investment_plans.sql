CREATE TABLE investment_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticker TEXT NOT NULL,
  entry_price REAL NOT NULL,
  target_type TEXT NOT NULL, -- 'price' | 'time'
  target_price REAL, -- if target_type = 'price'
  target_date TEXT, -- if target_type = 'time' (ISO date)
  planned_hold_months INTEGER, -- AI's estimated hold duration
  thesis TEXT NOT NULL, -- why we bought, what we expect
  sector TEXT,
  check_frequency TEXT NOT NULL DEFAULT 'weekly', -- 'realtime' for price targets, 'weekly' for time targets
  status TEXT NOT NULL DEFAULT 'active', -- active | completed | abandoned
  ai_conviction TEXT, -- AI's latest conviction about this position
  last_reviewed TEXT, -- when was this plan last reviewed
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_plans_ticker ON investment_plans(ticker);
CREATE INDEX idx_plans_status ON investment_plans(status);
