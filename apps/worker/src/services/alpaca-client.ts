// Alpaca Paper Trading REST client — fetch()-based, Cloudflare Workers compatible
// Base URL: https://paper-api.alpaca.markets/v2
// Auth: APCA-API-KEY-ID + APCA-API-SECRET-KEY headers

import type { Env } from "../types";

const ALPACA_BASE = "https://paper-api.alpaca.markets/v2";

export type AlpacaOrderSide = "buy" | "sell";
export type AlpacaOrderType = "market" | "limit" | "trailing_stop";
export type AlpacaTimeInForce = "day" | "gtc" | "ioc" | "fok";
export type AlpacaOrderStatus =
  | "new"
  | "partially_filled"
  | "filled"
  | "done_for_day"
  | "canceled"
  | "expired"
  | "replaced"
  | "pending_cancel"
  | "pending_replace";

export interface AlpacaOrder {
  id: string;
  client_order_id: string;
  created_at: string;
  updated_at: string;
  submitted_at: string;
  filled_at: string | null;
  symbol: string;
  qty: string;
  filled_qty: string;
  type: AlpacaOrderType;
  side: AlpacaOrderSide;
  time_in_force: AlpacaTimeInForce;
  limit_price: string | null;
  trail_percent: string | null;
  trail_price: string | null;
  hwm: string | null;
  filled_avg_price: string | null;
  status: AlpacaOrderStatus;
}

export interface AlpacaPosition {
  asset_id: string;
  symbol: string;
  qty: string;
  avg_entry_price: string;
  market_value: string;
  cost_basis: string;
  unrealized_pl: string;
  unrealized_plpc: string;
  current_price: string;
  side: "long" | "short";
}

export interface AlpacaAccount {
  id: string;
  cash: string;
  portfolio_value: string;
  equity: string;
  buying_power: string;
  long_market_value: string;
  short_market_value: string;
  status: string;
}

export interface PlaceOrderParams {
  symbol: string;
  qty: number;
  side: AlpacaOrderSide;
  type: AlpacaOrderType;
  time_in_force?: AlpacaTimeInForce;
  limit_price?: number;
  trail_percent?: number; // for trailing_stop type
  trail_price?: number;   // for trailing_stop type
  client_order_id?: string;
}

function getHeaders(env: Env): Record<string, string> {
  return {
    "APCA-API-KEY-ID": env.ALPACA_API_KEY_ID ?? "",
    "APCA-API-SECRET-KEY": env.ALPACA_API_SECRET_KEY ?? "",
    "Content-Type": "application/json",
  };
}

export function isAlpacaConfigured(env: Env): boolean {
  return Boolean(env.ALPACA_API_KEY_ID && env.ALPACA_API_SECRET_KEY);
}

async function alpacaFetch<T>(
  path: string,
  env: Env,
  options: RequestInit = {}
): Promise<{ data: T | null; error: string | null }> {
  if (!isAlpacaConfigured(env)) {
    return { data: null, error: "Alpaca API keys not configured" };
  }

  try {
    const res = await fetch(`${ALPACA_BASE}${path}`, {
      ...options,
      headers: {
        ...getHeaders(env),
        ...(options.headers as Record<string, string> ?? {}),
      },
    });

    if (!res.ok) {
      const text = await res.text();
      return { data: null, error: `Alpaca API error ${res.status}: ${text}` };
    }

    const data = (await res.json()) as T;
    return { data, error: null };
  } catch (err) {
    return { data: null, error: `Alpaca fetch failed: ${String(err)}` };
  }
}

// ─── Account ───

export async function getAlpacaAccount(env: Env): Promise<AlpacaAccount | null> {
  const { data } = await alpacaFetch<AlpacaAccount>("/account", env);
  return data;
}

// ─── Orders ───

export async function placeOrder(
  params: PlaceOrderParams,
  env: Env
): Promise<{ order: AlpacaOrder | null; error: string | null }> {
  const body: Record<string, unknown> = {
    symbol: params.symbol,
    qty: String(params.qty),
    side: params.side,
    type: params.type,
    time_in_force: params.time_in_force ?? "day",
  };

  if (params.type === "limit" && params.limit_price != null) {
    body.limit_price = String(params.limit_price);
  }

  if (params.type === "trailing_stop") {
    if (params.trail_percent != null) {
      body.trail_percent = String(params.trail_percent);
    } else if (params.trail_price != null) {
      body.trail_price = String(params.trail_price);
    }
  }

  if (params.client_order_id) {
    body.client_order_id = params.client_order_id;
  }

  const { data, error } = await alpacaFetch<AlpacaOrder>("/orders", env, {
    method: "POST",
    body: JSON.stringify(body),
  });

  return { order: data, error };
}

export async function cancelOrder(orderId: string, env: Env): Promise<boolean> {
  const { error } = await alpacaFetch(`/orders/${orderId}`, env, {
    method: "DELETE",
  });
  return error === null;
}

export async function getOrder(orderId: string, env: Env): Promise<AlpacaOrder | null> {
  const { data } = await alpacaFetch<AlpacaOrder>(`/orders/${orderId}`, env);
  return data;
}

export async function listOpenOrders(env: Env): Promise<AlpacaOrder[]> {
  const { data } = await alpacaFetch<AlpacaOrder[]>("/orders?status=open", env);
  return data ?? [];
}

// ─── Positions ───

export async function listPositions(env: Env): Promise<AlpacaPosition[]> {
  const { data } = await alpacaFetch<AlpacaPosition[]>("/positions", env);
  return data ?? [];
}

export async function getPosition(symbol: string, env: Env): Promise<AlpacaPosition | null> {
  const { data } = await alpacaFetch<AlpacaPosition>(`/positions/${symbol}`, env);
  return data;
}

export async function closePosition(
  symbol: string,
  env: Env
): Promise<{ order: AlpacaOrder | null; error: string | null }> {
  const { data, error } = await alpacaFetch<AlpacaOrder>(
    `/positions/${symbol}`,
    env,
    { method: "DELETE" }
  );
  return { order: data, error };
}

// ─── Convenience: buy market + trailing stop sell ───

/**
 * Places a market buy order.
 * If trailPercent is provided, also places a trailing stop sell order for the same qty.
 */
export async function buyWithTrailingStop(
  symbol: string,
  qty: number,
  trailPercent: number,
  env: Env
): Promise<{ buyOrder: AlpacaOrder | null; stopOrder: AlpacaOrder | null; error: string | null }> {
  const { order: buyOrder, error: buyError } = await placeOrder(
    { symbol, qty, side: "buy", type: "market", time_in_force: "day" },
    env
  );

  if (buyError || !buyOrder) {
    return { buyOrder: null, stopOrder: null, error: buyError ?? "Buy order failed" };
  }

  // Place trailing stop immediately
  const { order: stopOrder, error: stopError } = await placeOrder(
    {
      symbol,
      qty,
      side: "sell",
      type: "trailing_stop",
      time_in_force: "gtc",
      trail_percent: trailPercent,
      client_order_id: `trail_${buyOrder.id}`,
    },
    env
  );

  if (stopError) {
    // Buy succeeded but stop failed — log but don't fail
    console.error(`[Alpaca] Trailing stop failed for ${symbol}: ${stopError}`);
  }

  return { buyOrder, stopOrder, error: null };
}
