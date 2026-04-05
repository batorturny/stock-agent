import { useEffect, useRef } from "react";
import { createChart, type IChartApi, ColorType, AreaSeries } from "lightweight-charts";
import type { PricePoint } from "~/lib/api";

type Props = {
  ticker: string;
  data: PricePoint[];
};

export function PriceChart({ ticker, data }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!containerRef.current || data.length === 0) return;

    // Clean up previous chart
    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
    }

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#a1a1aa",
      },
      grid: {
        vertLines: { color: "#27272a" },
        horzLines: { color: "#27272a" },
      },
      width: containerRef.current.clientWidth,
      height: 300,
      timeScale: {
        timeVisible: true,
        borderColor: "#27272a",
      },
      rightPriceScale: {
        borderColor: "#27272a",
      },
      crosshair: {
        vertLine: { color: "#52525b" },
        horzLine: { color: "#52525b" },
      },
    });

    chartRef.current = chart;

    const areaSeries = chart.addSeries(AreaSeries, {
      topColor: "rgba(34, 197, 94, 0.3)",
      bottomColor: "rgba(34, 197, 94, 0.02)",
      lineColor: "rgba(34, 197, 94, 0.8)",
      lineWidth: 2,
    });

    // Sort by time and deduplicate
    const sorted = [...data]
      .sort(
        (a, b) =>
          new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime()
      )
      .map((p) => ({
        time: Math.floor(new Date(p.recordedAt).getTime() / 1000) as unknown as import("lightweight-charts").Time,
        value: p.price,
      }));

    // Deduplicate by time
    const unique = sorted.filter(
      (item, index, arr) => index === 0 || item.time !== arr[index - 1].time
    );

    areaSeries.setData(unique);
    chart.timeScale().fitContent();

    const handleResize = () => {
      if (containerRef.current && chartRef.current) {
        chartRef.current.applyOptions({
          width: containerRef.current.clientWidth,
        });
      }
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      chart.remove();
      chartRef.current = null;
    };
  }, [data]);

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
      <h3 className="mb-3 font-mono text-sm font-bold text-zinc-300">
        {ticker}
      </h3>
      <div ref={containerRef} />
      {data.length === 0 && (
        <p className="py-8 text-center text-sm text-zinc-600">
          No price data available for {ticker}
        </p>
      )}
    </div>
  );
}
