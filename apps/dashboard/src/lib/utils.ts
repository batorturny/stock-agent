import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);
}

export function formatPercent(value: number): string {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

export function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("hu-HU", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function sentimentColor(sentiment: number | null): string {
  if (sentiment === null) return "text-zinc-400";
  if (sentiment > 0.3) return "text-profit";
  if (sentiment < -0.3) return "text-loss";
  return "text-warning";
}

export function sentimentLabel(sentiment: number | null): string {
  if (sentiment === null) return "N/A";
  if (sentiment > 0.5) return "Very Positive";
  if (sentiment > 0.2) return "Positive";
  if (sentiment > -0.2) return "Neutral";
  if (sentiment > -0.5) return "Negative";
  return "Very Negative";
}
