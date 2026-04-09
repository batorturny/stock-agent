-- Adds politician_trades and copy_trade_queue tables for copy trading feature

CREATE TABLE IF NOT EXISTS `politician_trades` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`symbol` text NOT NULL,
	`name` text NOT NULL,
	`position` text,
	`owner_type` text,
	`transaction_type` text NOT NULL,
	`amount_from` real,
	`amount_to` real,
	`transaction_date` text NOT NULL,
	`filing_date` text NOT NULL,
	`fetched_at` text NOT NULL
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `copy_trade_queue` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`symbol` text NOT NULL,
	`side` text NOT NULL,
	`qty` real NOT NULL,
	`politician_name` text NOT NULL,
	`politician_trade_id` integer,
	`execute_after` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`alpaca_order_id` text,
	`reason` text,
	`created_at` text NOT NULL,
	`executed_at` text
);
