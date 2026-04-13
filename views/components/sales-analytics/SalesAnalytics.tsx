import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  addDays,
  addMonths,
  eachDayOfInterval,
  endOfDay,
  endOfMonth,
  format,
  isSameDay,
  isWithinInterval,
  startOfDay,
  startOfMonth,
  subDays,
  subMonths,
} from "date-fns";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AnalyticsFilters,
  DaySales,
  PaymentMethod,
  PeriodMetrics,
  SalesPeriod,
  SavedPreset,
} from "./salesAnalytics.types";
import {
  compareMetrics,
  daySalesMap,
  generateMockSalesData,
  getMetricsForRange,
  listOptions,
} from "./salesAnalytics.mock";
import "./SalesAnalytics.css";

type ThemeMode = "light" | "dark";

interface SalesAnalyticsProps {
  darkMode?: boolean;
}

const PRESET_STORAGE_KEY = "bb-sales-analytics-presets";

type DaySummary = { amount: number; transactions: number };
type HourStat = { hour: number; total: number; orders: number };

function currency(value: number) {
  return `₱${value.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function percentage(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function periodFromSingleDate(date: Date, label: string): SalesPeriod {
  return { start: startOfDay(date), end: endOfDay(date), label };
}

function getRangeLabel(start: Date, end: Date) {
  return `${format(start, "MMM d")} - ${format(end, "MMM d")}`;
}

function loadPresets(): SavedPreset[] {
  try {
    const raw = localStorage.getItem(PRESET_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SavedPreset[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export const SalesAnalytics: React.FC<SalesAnalyticsProps> = ({ darkMode = false }) => {
  const today = startOfDay(new Date());

  const [loading, setLoading] = useState(true);
  const [salesData, setSalesData] = useState<DaySales[]>([]);
  const [currentMonth, setCurrentMonth] = useState(startOfMonth(today));
  const [selectedDates, setSelectedDates] = useState<Date[]>([today]);
  const [dragStart, setDragStart] = useState<Date | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [filters, setFilters] = useState<AnalyticsFilters>({ staff: "all", paymentMethod: "all", category: "all" });
  const [periodA, setPeriodA] = useState<SalesPeriod>(periodFromSingleDate(today, "Today"));
  const [periodB, setPeriodB] = useState<SalesPeriod>(periodFromSingleDate(subDays(today, 1), "Yesterday"));
  const [customRangeMode, setCustomRangeMode] = useState(false);
  const [customAStart, setCustomAStart] = useState(format(subDays(today, 7), "yyyy-MM-dd"));
  const [customAEnd, setCustomAEnd] = useState(format(today, "yyyy-MM-dd"));
  const [customBStart, setCustomBStart] = useState(format(subDays(today, 14), "yyyy-MM-dd"));
  const [customBEnd, setCustomBEnd] = useState(format(subDays(today, 8), "yyyy-MM-dd"));
  const [presets, setPresets] = useState<SavedPreset[]>([]);
  const [presetName, setPresetName] = useState("");

  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setLoading(true);
    const t = window.setTimeout(() => {
      setSalesData(generateMockSalesData(180));
      setPresets(loadPresets());
      setLoading(false);
    }, 320);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    const handleMouseUp = () => {
      setIsDragging(false);
      setDragStart(null);
    };
    window.addEventListener("mouseup", handleMouseUp);
    return () => window.removeEventListener("mouseup", handleMouseUp);
  }, []);

  const options = useMemo(() => listOptions(salesData), [salesData]);
  const dayMap = useMemo<Record<string, DaySummary>>(() => daySalesMap(salesData, filters), [salesData, filters]);

  const maxSales = useMemo(() => {
    const values = Object.keys(dayMap).map((key) => dayMap[key].amount);
    return values.length ? Math.max(...values, 1) : 1;
  }, [dayMap]);

  const metricsA = useMemo(() => getMetricsForRange(salesData, periodA.start, periodA.end, filters), [salesData, periodA, filters]);
  const metricsB = useMemo(() => getMetricsForRange(salesData, periodB.start, periodB.end, filters), [salesData, periodB, filters]);
  const metricCompare = useMemo(() => compareMetrics(metricsA, metricsB), [metricsA, metricsB]);

  const trendLineData = useMemo(() => {
    const days = eachDayOfInterval({ start: periodA.start, end: periodA.end });
    return days.map((d: Date) => {
      const key = format(d, "yyyy-MM-dd");
      const summary = dayMap[key] || { amount: 0, transactions: 0 };
      return {
        label: format(d, "MMM d"),
        sales: summary.amount,
        tx: summary.transactions,
      };
    });
  }, [periodA, dayMap]);

  const barCompareData = useMemo(() => {
    const daysA = eachDayOfInterval({ start: periodA.start, end: periodA.end });
    const daysB = eachDayOfInterval({ start: periodB.start, end: periodB.end });
    const len = Math.max(daysA.length, daysB.length);
    return Array.from({ length: len }).map((_, i) => {
      const a = daysA[i] || null;
      const b = daysB[i] || null;
      return {
        label: a ? format(a, "MM/dd") : b ? format(b, "MM/dd") : `${i + 1}`,
        periodA: a ? (dayMap[format(a, "yyyy-MM-dd")]?.amount || 0) : 0,
        periodB: b ? (dayMap[format(b, "yyyy-MM-dd")]?.amount || 0) : 0,
      };
    });
  }, [periodA, periodB, dayMap]);

  const pieData = useMemo(
    () => (Object.keys(metricsA.paymentBreakdown) as PaymentMethod[]).map((method) => ({
      name: method,
      value: metricsA.paymentBreakdown[method],
    })),
    [metricsA.paymentBreakdown]
  );

  const topProductsData = useMemo(() => {
    const rows: Array<{ name: string; qty: number }> = [];
    for (const name of Object.keys(metricsA.productTotals)) {
      rows.push({ name, qty: metricsA.productTotals[name] });
    }
    return rows.sort((a, b) => b.qty - a.qty).slice(0, 8);
  }, [metricsA.productTotals]);

  const peakHourA = useMemo(
    () => metricsA.hourlyTotals.reduce<HourStat>(
      (best: HourStat, curr: HourStat) => (curr.total > best.total ? curr : best),
      { hour: 0, total: 0, orders: 0 }
    ),
    [metricsA.hourlyTotals]
  );

  const peakHourB = useMemo(
    () => metricsB.hourlyTotals.reduce<HourStat>(
      (best: HourStat, curr: HourStat) => (curr.total > best.total ? curr : best),
      { hour: 0, total: 0, orders: 0 }
    ),
    [metricsB.hourlyTotals]
  );

  const insights = useMemo(() => {
    const topItemA = metricsA.bestSeller;
    const topItemB = metricsB.bestSeller;
    const slowest = Object.keys(dayMap)
      .map((k) => ({
        weekday: format(new Date(`${k}T00:00:00`), "EEEE"),
        amount: dayMap[k].amount,
      }))
      .reduce<Record<string, { total: number; count: number }>>((acc, row) => {
        acc[row.weekday] = acc[row.weekday] || { total: 0, count: 0 };
        acc[row.weekday].total += row.amount;
        acc[row.weekday].count += 1;
        return acc;
      }, {});

    const weekdaySlow = Object.entries(slowest)
      .map(([day, s]) => ({ day, avg: s.total / s.count }))
      .sort((a, b) => a.avg - b.avg)[0]?.day || "Tuesday";

    return [
      `Peak hour was ${peakHourA.hour}:00-${peakHourA.hour + 1}:00 in ${periodA.label} vs ${peakHourB.hour}:00-${peakHourB.hour + 1}:00 in ${periodB.label}.`,
      `${topItemA} demand is ${metricCompare.transactions >= 0 ? "up" : "down"} ${Math.abs(metricCompare.transactions).toFixed(0)}% compared to ${periodB.label}.`,
      `${weekdaySlow} is typically your slowest day based on current data.`,
      `Forecast: if current trend holds, next-day sales may reach ${currency(metricsA.totalSales * 1.06)}.`
        .replace("next-day", "next day"),
      topItemB !== "N/A" ? `${topItemB} was the strongest seller during ${periodB.label}.` : "No best seller identified for comparison period.",
    ];
  }, [metricsA, metricsB, metricCompare.transactions, peakHourA, peakHourB, periodA.label, periodB.label, dayMap]);

  const calendarDays = useMemo(() => {
    const monthStart = startOfMonth(currentMonth);
    const monthEnd = endOfMonth(currentMonth);
    const offset = monthStart.getDay();
    const gridStart = subDays(monthStart, offset);
    return Array.from({ length: 42 }).map((_, i) => addDays(gridStart, i));
  }, [currentMonth]);

  const selectedDateKeys = useMemo(
    () => selectedDates.map((d: Date) => format(d, "yyyy-MM-dd")),
    [selectedDates]
  );

  const getHeatLevel = (amount: number) => {
    if (amount <= 0) return "var(--sa-heat-0)";
    const ratio = amount / maxSales;
    if (ratio <= 0.25) return "var(--sa-heat-1)";
    if (ratio <= 0.5) return "var(--sa-heat-2)";
    if (ratio <= 0.75) return "var(--sa-heat-3)";
    return "var(--sa-heat-4)";
  };

  const updateFromSelectedDates = (dates: Date[]) => {
    const sorted = [...dates].sort((a, b) => a.getTime() - b.getTime());
    if (sorted.length >= 1) {
      setPeriodA(periodFromSingleDate(sorted[sorted.length - 1], format(sorted[sorted.length - 1], "MMM d")));
    }
    if (sorted.length >= 2) {
      setPeriodB(periodFromSingleDate(sorted[sorted.length - 2], format(sorted[sorted.length - 2], "MMM d")));
    }
  };

  const toggleDate = (date: Date) => {
    const exists = selectedDates.some((d: Date) => isSameDay(d, date));
    const next = exists ? selectedDates.filter((d: Date) => !isSameDay(d, date)) : [...selectedDates, date];
    setSelectedDates(next);
    updateFromSelectedDates(next);
  };

  const onDayMouseDown = (date: Date) => {
    setDragStart(date);
    setIsDragging(true);
    toggleDate(date);
  };

  const onDayMouseEnter = (date: Date) => {
    if (!isDragging || !dragStart) return;
    const range = eachDayOfInterval({
      start: dragStart < date ? dragStart : date,
      end: dragStart < date ? date : dragStart,
    });
    setSelectedDates((prev: Date[]) => {
      const merged = [...prev];
      range.forEach((d: Date) => {
        if (!merged.some((x) => isSameDay(x, d))) merged.push(d);
      });
      updateFromSelectedDates(merged);
      return merged;
    });
  };

  const applyQuickCompare = (mode: "day" | "week" | "month") => {
    const now = today;
    if (mode === "day") {
      setPeriodA(periodFromSingleDate(now, "Today"));
      setPeriodB(periodFromSingleDate(subDays(now, 1), "Yesterday"));
      setSelectedDates([subDays(now, 1), now]);
      return;
    }
    if (mode === "week") {
      const aStart = subDays(now, 6);
      const aEnd = now;
      const bStart = subDays(aStart, 7);
      const bEnd = subDays(aEnd, 7);
      setPeriodA({ start: aStart, end: endOfDay(aEnd), label: "This Week" });
      setPeriodB({ start: bStart, end: endOfDay(bEnd), label: "Last Week" });
      setSelectedDates([bEnd, aEnd]);
      return;
    }
    const aStart = startOfMonth(now);
    const aEnd = endOfDay(now);
    const bStart = startOfMonth(subMonths(now, 1));
    const bEnd = endOfMonth(subMonths(now, 1));
    setPeriodA({ start: aStart, end: aEnd, label: "This Month" });
    setPeriodB({ start: bStart, end: endOfDay(bEnd), label: "Last Month" });
    setSelectedDates([bEnd, now]);
  };

  const applyCustomRange = () => {
    setPeriodA({
      start: startOfDay(new Date(`${customAStart}T00:00:00`)),
      end: endOfDay(new Date(`${customAEnd}T00:00:00`)),
      label: "Custom A",
    });
    setPeriodB({
      start: startOfDay(new Date(`${customBStart}T00:00:00`)),
      end: endOfDay(new Date(`${customBEnd}T00:00:00`)),
      label: "Custom B",
    });
  };

  const savePreset = () => {
    const name = presetName.trim();
    if (!name) return;
    const next: SavedPreset = {
      id: `${Date.now()}`,
      name,
      periodA: { start: periodA.start.toISOString(), end: periodA.end.toISOString(), label: periodA.label },
      periodB: { start: periodB.start.toISOString(), end: periodB.end.toISOString(), label: periodB.label },
    };
    const updated = [...presets, next];
    setPresets(updated);
    localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(updated));
    setPresetName("");
  };

  const loadPreset = (preset: SavedPreset) => {
    setPeriodA({ start: new Date(preset.periodA.start), end: new Date(preset.periodA.end), label: preset.periodA.label });
    setPeriodB({ start: new Date(preset.periodB.start), end: new Date(preset.periodB.end), label: preset.periodB.label });
  };

  const exportCsv = () => {
    const header = "Period,Total Sales,Transactions,Avg Order,Best Seller\n";
    const rows = [
      `${periodA.label},${metricsA.totalSales},${metricsA.transactionCount},${metricsA.averageOrderValue},${metricsA.bestSeller}`,
      `${periodB.label},${metricsB.totalSales},${metricsB.transactionCount},${metricsB.averageOrderValue},${metricsB.bestSeller}`,
    ].join("\n");
    const blob = new Blob([header + rows], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sales-analytics-${format(new Date(), "yyyyMMdd-HHmm")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportPdf = () => {
    window.print();
  };

  const shareEmail = () => {
    const summary = `Sales Analytics Summary\n${periodA.label}: ${currency(metricsA.totalSales)} (${metricsA.transactionCount} tx)\n${periodB.label}: ${currency(metricsB.totalSales)} (${metricsB.transactionCount} tx)\nChange: ${percentage(metricCompare.sales)}`;
    window.location.href = `mailto:?subject=${encodeURIComponent("Brother Bean Sales Analytics")}&body=${encodeURIComponent(summary)}`;
  };

  const paymentColors = ["#d97706", "#10b981", "#3b82f6"];

  const theme: ThemeMode = darkMode ? "dark" : "light";

  return (
    <div ref={wrapperRef} className="sales-analytics" data-theme={theme}>
      <div>
        <div className="sa-breadcrumb">Dashboard / Sales Analytics</div>
        <div className="sa-header">
          <div className="sa-title">Sales Analytics</div>
          <div className="sa-row">
            <button className="sa-btn" onClick={exportPdf} type="button">Download PDF</button>
            <button className="sa-btn" onClick={exportCsv} type="button">Download Excel</button>
            <button className="sa-btn" onClick={() => window.print()} type="button">Print View</button>
            <button className="sa-btn" onClick={shareEmail} type="button">Share via Email</button>
          </div>
        </div>
      </div>

      <div className="sa-card bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-50">
        <div className="sa-row">
          <button className="sa-btn sa-btn-primary" type="button" onClick={() => applyQuickCompare("day")}>Yesterday vs Today</button>
          <button className="sa-btn" type="button" onClick={() => applyQuickCompare("week")}>Last Week vs This Week</button>
          <button className="sa-btn" type="button" onClick={() => applyQuickCompare("month")}>Last Month vs This Month</button>
          <button className="sa-btn" type="button" onClick={() => setCustomRangeMode((v: boolean) => !v)}>Custom Range</button>
        </div>
        {customRangeMode && (
          <div className="sa-grid-2-equal" style={{ marginTop: 10 }}>
            <div className="sa-subcard">
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Period A</div>
              <div className="sa-row">
                <input className="sa-input" type="date" value={customAStart} onChange={(e) => setCustomAStart(e.target.value)} />
                <input className="sa-input" type="date" value={customAEnd} onChange={(e) => setCustomAEnd(e.target.value)} />
              </div>
            </div>
            <div className="sa-subcard">
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Period B</div>
              <div className="sa-row">
                <input className="sa-input" type="date" value={customBStart} onChange={(e) => setCustomBStart(e.target.value)} />
                <input className="sa-input" type="date" value={customBEnd} onChange={(e) => setCustomBEnd(e.target.value)} />
                <button className="sa-btn sa-btn-primary" type="button" onClick={applyCustomRange}>Apply</button>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="sa-card bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-50">
        <div className="sa-filters">
          <select className="sa-select" value={filters.staff} onChange={(e) => setFilters((f) => ({ ...f, staff: e.target.value }))}>
            <option value="all">All Staff</option>
            {options.staff.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className="sa-select" value={filters.paymentMethod} onChange={(e) => setFilters((f) => ({ ...f, paymentMethod: e.target.value as AnalyticsFilters["paymentMethod"] }))}>
            <option value="all">All Payment Methods</option>
            <option value="Cash">Cash</option>
            <option value="GCash">GCash</option>
            <option value="Card">Card</option>
          </select>
          <select className="sa-select" value={filters.category} onChange={(e) => setFilters((f) => ({ ...f, category: e.target.value }))}>
            <option value="all">All Categories</option>
            {options.category.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>

      {loading ? (
        <div className="sa-loading">Loading analytics dataset...</div>
      ) : (
        <>
          <div className="sa-grid-2">
            <div className="sa-card bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-50">
              <div className="sa-calendar-head">
                <button className="sa-btn" type="button" onClick={() => setCurrentMonth((m) => addMonths(m, -1))}>Prev</button>
                <div style={{ fontWeight: 800 }}>{format(currentMonth, "MMMM yyyy")}</div>
                <button className="sa-btn" type="button" onClick={() => setCurrentMonth((m) => addMonths(m, 1))}>Next</button>
              </div>
              <div className="sa-week-grid">
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                  <div key={d} className="sa-week-day">{d}</div>
                ))}
              </div>
              <div className="sa-calendar-scroll">
                <div className="sa-calendar-grid">
                  {calendarDays.map((date) => {
                    const key = format(date, "yyyy-MM-dd");
                    const summary = dayMap[key] || { amount: 0, transactions: 0 };
                    const selected = selectedDateKeys.includes(key);
                    const inCurrentMonth = date.getMonth() === currentMonth.getMonth();
                    const dayIsToday = isSameDay(date, today);
                    return (
                      <div
                        key={key}
                        className={`sa-day ${selected ? "is-selected" : ""} ${!inCurrentMonth ? "is-outside" : ""} ${dayIsToday ? "is-today" : ""}`}
                        style={{ background: getHeatLevel(summary.amount) }}
                        title={`${format(date, "MMM d")}: ${currency(summary.amount)} (${summary.transactions} tx)`}
                        onClick={() => toggleDate(date)}
                        onMouseDown={() => onDayMouseDown(date)}
                        onMouseEnter={() => onDayMouseEnter(date)}
                        role="button"
                        tabIndex={0}
                      >
                        <div className="sa-day-top">
                          <span>{format(date, "d")}</span>
                          {summary.transactions > 0 ? <span className="sa-dot" /> : null}
                        </div>
                        <div className="sa-day-sales">{currency(summary.amount)}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div style={{ marginTop: 10, color: "var(--sa-text-2)", fontSize: 12 }}>
                Selected: {selectedDates.length ? selectedDates.map((d) => format(d, "MMM d")).join(", ") : "None"}
              </div>
            </div>

            <div className="sa-card bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-50">
              <div className="sa-compare-grid">
                <div className="sa-subcard">
                  <div style={{ fontWeight: 800, marginBottom: 8 }}>{periodA.label}</div>
                  <div className="sa-metric">
                    <div className="sa-metric-label">Total Sales</div>
                    <div className="sa-metric-value currency">{currency(metricsA.totalSales)}</div>
                  </div>
                  <div className="sa-metric">
                    <div className="sa-metric-label">Transactions</div>
                    <div className="sa-metric-value">{metricsA.transactionCount}</div>
                  </div>
                  <div className="sa-metric">
                    <div className="sa-metric-label">Avg Order</div>
                    <div className="sa-metric-value">{currency(metricsA.averageOrderValue)}</div>
                  </div>
                  <div className="sa-metric">
                    <div className="sa-metric-label">Best Seller</div>
                    <div className="sa-metric-value">{metricsA.bestSeller}</div>
                  </div>
                </div>
                <div className="sa-subcard">
                  <div style={{ fontWeight: 800, marginBottom: 8 }}>{periodB.label}</div>
                  <div className="sa-metric">
                    <div className="sa-metric-label">Total Sales</div>
                    <div className="sa-metric-value currency">{currency(metricsB.totalSales)}</div>
                  </div>
                  <div className="sa-metric">
                    <div className="sa-metric-label">Transactions</div>
                    <div className="sa-metric-value">{metricsB.transactionCount}</div>
                  </div>
                  <div className="sa-metric">
                    <div className="sa-metric-label">Avg Order</div>
                    <div className="sa-metric-value">{currency(metricsB.averageOrderValue)}</div>
                  </div>
                  <div className="sa-metric">
                    <div className="sa-metric-label">Best Seller</div>
                    <div className="sa-metric-value">{metricsB.bestSeller}</div>
                  </div>
                </div>
              </div>

              <div className="sa-row" style={{ marginTop: 12 }}>
                <div className={metricCompare.sales >= 0 ? "sa-trend-up" : "sa-trend-down"}>Sales {percentage(metricCompare.sales)}</div>
                <div className={metricCompare.transactions >= 0 ? "sa-trend-up" : "sa-trend-down"}>Transactions {percentage(metricCompare.transactions)}</div>
                <div className={metricCompare.avgOrder >= 0 ? "sa-trend-up" : "sa-trend-down"}>Avg Order {percentage(metricCompare.avgOrder)}</div>
              </div>
            </div>
          </div>

          <div className="sa-card bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-50">
            <div style={{ fontWeight: 800, marginBottom: 10 }}>Main Trend Line Chart ({getRangeLabel(periodA.start, periodA.end)})</div>
            <div className="sa-chart-wrap">
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={trendLineData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="label" />
                  <YAxis />
                  <Tooltip formatter={(v) => currency(typeof v === "number" ? v : Number(v) || 0)} />
                  <Legend />
                  <Line type="monotone" dataKey="sales" stroke="#d97706" strokeWidth={3} dot={false} name="Sales" animationDuration={420} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="sa-grid-2-equal">
            <div className="sa-card bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-50">
              <div style={{ fontWeight: 800, marginBottom: 10 }}>Bar Comparison</div>
              <div className="sa-chart-wrap">
                <ResponsiveContainer width="100%" height={290}>
                  <BarChart data={barCompareData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="label" />
                    <YAxis />
                    <Tooltip formatter={(v) => currency(typeof v === "number" ? v : Number(v) || 0)} />
                    <Legend />
                    <Bar dataKey="periodA" fill="#d97706" name={periodA.label} animationDuration={420} />
                    <Bar dataKey="periodB" fill="#94a3b8" name={periodB.label} animationDuration={420} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="sa-card bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-50">
              <div style={{ fontWeight: 800, marginBottom: 10 }}>Payment Method Breakdown</div>
              <div className="sa-chart-wrap">
                <ResponsiveContainer width="100%" height={290}>
                  <PieChart>
                    <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={56} outerRadius={90} label>
                      {pieData.map((entry, i) => (
                        <Cell key={`${entry.name}-${i}`} fill={paymentColors[i % paymentColors.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v) => currency(typeof v === "number" ? v : Number(v) || 0)} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          <div className="sa-grid-2-equal">
            <div className="sa-card bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-50">
              <div style={{ fontWeight: 800, marginBottom: 10 }}>Top Products</div>
              {topProductsData.length ? (
                <div className="sa-chart-wrap">
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={topProductsData} layout="vertical" margin={{ left: 80 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" />
                      <YAxis dataKey="name" type="category" width={160} />
                      <Tooltip />
                      <Bar dataKey="qty" fill="#10b981" animationDuration={420} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="sa-empty">No products found for this period.</div>
              )}
            </div>

            <div className="sa-card bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-50">
              <div style={{ fontWeight: 800, marginBottom: 10 }}>Peak Hours Heatmap</div>
              <div className="sa-week-grid" style={{ gridTemplateColumns: "repeat(6, minmax(0, 1fr))" }}>
                {metricsA.hourlyTotals.filter((h) => h.hour >= 7 && h.hour <= 20).map((h) => {
                  const intensity = metricsA.hourlyTotals.length ? h.total / Math.max(...metricsA.hourlyTotals.map((x) => x.total), 1) : 0;
                  const bg = intensity <= 0.2
                    ? "var(--sa-heat-0)"
                    : intensity <= 0.4
                    ? "var(--sa-heat-1)"
                    : intensity <= 0.65
                    ? "var(--sa-heat-2)"
                    : intensity <= 0.85
                    ? "var(--sa-heat-3)"
                    : "var(--sa-heat-4)";
                  return (
                    <div key={h.hour} className="sa-subcard" style={{ background: bg }} title={`${h.hour}:00 - ${currency(h.total)} (${h.orders} orders)`}>
                      <div style={{ fontSize: 11, color: "var(--sa-text-2)" }}>{h.hour}:00</div>
                      <div style={{ fontWeight: 800 }}>{currency(h.total)}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="sa-card bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-50">
            <div style={{ fontWeight: 800, marginBottom: 10 }}>Smart Insights</div>
            <div className="sa-insights">
              {insights.map((insight) => (
                <div className="sa-insight" key={insight}>{insight}</div>
              ))}
            </div>
          </div>

          <div className="sa-card bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-50">
            <div style={{ fontWeight: 800, marginBottom: 10 }}>Custom Presets</div>
            <div className="sa-row" style={{ marginBottom: 10 }}>
              <input className="sa-input" value={presetName} onChange={(e) => setPresetName(e.target.value)} placeholder="Preset name (e.g. Christmas Week)" />
              <button className="sa-btn sa-btn-primary" type="button" onClick={savePreset}>Save Current Range</button>
            </div>
            <div className="sa-presets">
              {presets.length ? (
                presets.map((preset) => (
                  <button key={preset.id} className="sa-preset-chip" type="button" onClick={() => loadPreset(preset)}>
                    {preset.name}
                  </button>
                ))
              ) : (
                <div className="sa-empty" style={{ width: "100%" }}>No presets saved yet.</div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default SalesAnalytics;
