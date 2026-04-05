CREATE TABLE `portfolio` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `ticker` text NOT NULL,
  `shares` real NOT NULL,
  `avg_price` real NOT NULL,
  `bought_at` text NOT NULL,
  `status` text DEFAULT 'open' NOT NULL,
  `close_price` real,
  `close_reason` text,
  `closed_at` text
);

CREATE TABLE `trades` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `ticker` text NOT NULL,
  `action` text NOT NULL,
  `shares` real NOT NULL,
  `price` real NOT NULL,
  `total` real NOT NULL,
  `reason` text,
  `confidence` real,
  `executed_at` text NOT NULL
);

CREATE TABLE `news` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `source` text NOT NULL,
  `title` text NOT NULL,
  `url` text NOT NULL,
  `summary` text,
  `tickers` text,
  `sentiment` real,
  `impact` integer,
  `time_horizon` text,
  `published_at` text,
  `scraped_at` text NOT NULL
);

CREATE TABLE `prices` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `ticker` text NOT NULL,
  `price` real NOT NULL,
  `open` real,
  `high` real,
  `low` real,
  `volume` integer,
  `recorded_at` text NOT NULL
);

CREATE TABLE `analysis` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `type` text NOT NULL,
  `picks` text NOT NULL,
  `outlook` text NOT NULL,
  `portfolio_changes` text,
  `risk_warnings` text,
  `created_at` text NOT NULL
);

CREATE TABLE `account` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `cash` real DEFAULT 5000.0 NOT NULL,
  `total_value` real DEFAULT 5000.0 NOT NULL,
  `updated_at` text NOT NULL
);

-- Indexes for performance
CREATE INDEX `idx_portfolio_status` ON `portfolio` (`status`);
CREATE INDEX `idx_portfolio_ticker` ON `portfolio` (`ticker`);
CREATE INDEX `idx_trades_executed_at` ON `trades` (`executed_at`);
CREATE INDEX `idx_trades_ticker` ON `trades` (`ticker`);
CREATE INDEX `idx_news_scraped_at` ON `news` (`scraped_at`);
CREATE INDEX `idx_news_source` ON `news` (`source`);
CREATE INDEX `idx_prices_ticker_recorded` ON `prices` (`ticker`, `recorded_at`);
CREATE INDEX `idx_analysis_type_created` ON `analysis` (`type`, `created_at`);
