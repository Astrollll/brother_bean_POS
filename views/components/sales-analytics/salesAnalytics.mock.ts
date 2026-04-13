import {
  addDays,
  format,
  isAfter,
  isBefore,
  isSameDay,
  setHours,
  setMinutes,
  startOfDay,
} from "date-fns";
import {
  AnalyticsFilters,
  DaySales,
  PaymentMethod,
  PeriodMetrics,
  SaleTransaction,
} from "./salesAnalytics.types";

const STAFF = ["Ariane", "Miguel", "Bea", "Jules", "Kaye"];
const CATEGORIES = ["Coffee", "Non-Coffee", "Pastry", "Sandwich"];

const PRODUCT_CATALOG = [
  { name: "Spanish Oat Latte", category: "Coffee", basePrice: 175 },
  { name: "Caramel Macchiato", category: "Coffee", basePrice: 170 },
  { name: "Americano", category: "Coffee", basePrice: 120 },
  { name: "Iced Matcha Latte", category: "Non-Coffee", basePrice: 180 },
  { name: "Dark Mocha", category: "Coffee", basePrice: 165 },
  { name: "Signature Cold Brew", category: "Coffee", basePrice: 160 },
  { name: "Butter Croissant", category: "Pastry", basePrice: 95 },
  { name: "Blueberry Cheesecake", category: "Pastry", basePrice: 145 },
  { name: "Club Sandwich", category: "Sandwich", basePrice: 210 },
  { name: "Chicken Pesto Panini", category: "Sandwich", basePrice: 220 },
];

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = Math.sin(s) * 10000;
    return s - Math.floor(s);
  };
}

function getHourDemandMultiplier(hour: number): number {
  if (hour >= 7 && hour <= 10) return 1.7;
  if (hour >= 11 && hour <= 13) return 1.4;
  if (hour >= 14 && hour <= 16) return 1.55;
  if (hour >= 17 && hour <= 19) return 1.15;
  return 0.7;
}

function getWeekdayMultiplier(day: number): number {
  if (day === 0) return 0.78;
  if (day === 6) return 0.92;
  if (day === 2) return 0.88;
  if (day === 5) return 1.12;
  return 1;
}

function randomPayment(rnd: () => number): PaymentMethod {
  const roll = rnd();
  if (roll < 0.52) return "Cash";
  if (roll < 0.85) return "GCash";
  return "Card";
}

function pickProduct(hour: number, rnd: () => number) {
  const morningBias = hour <= 11;
  const pastryBoost = morningBias ? 0.15 : 0;
  const roll = rnd();

  const weighted = PRODUCT_CATALOG.map((item) => {
    const coffeeWeight = item.category === "Coffee" ? 0.55 : 0.22;
    const pastryWeight = item.category === "Pastry" ? 0.14 + pastryBoost : 0;
    const nonCoffeeWeight = item.category === "Non-Coffee" ? 0.16 : 0;
    const sandwichWeight = item.category === "Sandwich" ? 0.15 : 0;
    return { item, weight: coffeeWeight + pastryWeight + nonCoffeeWeight + sandwichWeight };
  });

  let cumulative = 0;
  const total = weighted.reduce((sum, p) => sum + p.weight, 0);
  const marker = roll * total;
  for (const entry of weighted) {
    cumulative += entry.weight;
    if (marker <= cumulative) return entry.item;
  }
  return PRODUCT_CATALOG[0];
}

export function generateMockSalesData(days = 120): DaySales[] {
  const start = startOfDay(addDays(new Date(), -days + 1));
  const result: DaySales[] = [];

  for (let index = 0; index < days; index += 1) {
    const day = addDays(start, index);
    const dateKey = format(day, "yyyy-MM-dd");
    const rnd = seededRandom(Number(format(day, "yyyyMMdd")));
    const weekdayMultiplier = getWeekdayMultiplier(day.getDay());

    const transactions: SaleTransaction[] = [];
    let txnCounter = 0;

    for (let hour = 7; hour <= 20; hour += 1) {
      const base = 2 + Math.floor(rnd() * 4);
      const expected = Math.max(
        0,
        Math.round(base * getHourDemandMultiplier(hour) * weekdayMultiplier + (rnd() - 0.45) * 2)
      );

      for (let i = 0; i < expected; i += 1) {
        const product = pickProduct(hour, rnd);
        const qty = rnd() < 0.18 ? 2 : 1;
        const variance = 0.92 + rnd() * 0.2;
        const amount = Math.round(product.basePrice * qty * variance);
        const timestamp = setMinutes(setHours(day, hour), Math.floor(rnd() * 60));

        transactions.push({
          id: `${dateKey}-${txnCounter}`,
          createdAt: timestamp.toISOString(),
          amount,
          paymentMethod: randomPayment(rnd),
          staff: STAFF[Math.floor(rnd() * STAFF.length)],
          category: product.category,
          itemName: product.name,
          quantity: qty,
        });
        txnCounter += 1;
      }
    }

    result.push({ dateKey, transactions });
  }

  return result;
}

export function inDateRange(date: Date, start: Date, end: Date): boolean {
  return !isBefore(date, startOfDay(start)) && !isAfter(date, addDays(startOfDay(end), 1));
}

export function applyFilters(transactions: SaleTransaction[], filters: AnalyticsFilters): SaleTransaction[] {
  return transactions.filter((tx) => {
    if (filters.staff !== "all" && tx.staff !== filters.staff) return false;
    if (filters.paymentMethod !== "all" && tx.paymentMethod !== filters.paymentMethod) return false;
    if (filters.category !== "all" && tx.category !== filters.category) return false;
    return true;
  });
}

export function getMetricsForRange(
  sales: DaySales[],
  start: Date,
  end: Date,
  filters: AnalyticsFilters
): PeriodMetrics {
  const byHour = new Map<number, { total: number; orders: number }>();
  const paymentBreakdown: Record<PaymentMethod, number> = { Cash: 0, GCash: 0, Card: 0 };
  const categoryTotals: Record<string, number> = {};
  const productTotals: Record<string, number> = {};

  for (let h = 0; h <= 23; h += 1) {
    byHour.set(h, { total: 0, orders: 0 });
  }

  const txs = sales
    .filter((d) => inDateRange(new Date(`${d.dateKey}T00:00:00`), start, end))
    .flatMap((d) => d.transactions);

  const filtered = applyFilters(txs, filters);
  let totalSales = 0;

  filtered.forEach((tx) => {
    totalSales += tx.amount;
    paymentBreakdown[tx.paymentMethod] += tx.amount;
    categoryTotals[tx.category] = (categoryTotals[tx.category] || 0) + tx.amount;
    productTotals[tx.itemName] = (productTotals[tx.itemName] || 0) + tx.quantity;

    const hour = new Date(tx.createdAt).getHours();
    const row = byHour.get(hour);
    if (row) {
      row.total += tx.amount;
      row.orders += 1;
    }
  });

  const top = Object.entries(productTotals).sort((a, b) => b[1] - a[1])[0];
  const transactionCount = filtered.length;

  return {
    totalSales,
    transactionCount,
    averageOrderValue: transactionCount ? totalSales / transactionCount : 0,
    bestSeller: top ? top[0] : "N/A",
    paymentBreakdown,
    hourlyTotals: Array.from(byHour.entries()).map(([hour, val]) => ({ hour, total: val.total, orders: val.orders })),
    categoryTotals,
    productTotals,
  };
}

export function listOptions(sales: DaySales[]) {
  const staff = new Set<string>();
  const category = new Set<string>();

  sales.forEach((day) => {
    day.transactions.forEach((tx) => {
      staff.add(tx.staff);
      category.add(tx.category);
    });
  });

  return {
    staff: Array.from(staff).sort(),
    category: Array.from(category).sort(),
  };
}

export function daySalesMap(sales: DaySales[], filters: AnalyticsFilters): Record<string, { amount: number; transactions: number }> {
  const map: Record<string, { amount: number; transactions: number }> = {};
  sales.forEach((day) => {
    const tx = applyFilters(day.transactions, filters);
    map[day.dateKey] = {
      amount: tx.reduce((sum, item) => sum + item.amount, 0),
      transactions: tx.length,
    };
  });
  return map;
}

export function compareMetrics(a: PeriodMetrics, b: PeriodMetrics) {
  const percent = (current: number, previous: number) => {
    if (previous === 0) return current > 0 ? 100 : 0;
    return ((current - previous) / previous) * 100;
  };

  return {
    sales: percent(a.totalSales, b.totalSales),
    transactions: percent(a.transactionCount, b.transactionCount),
    avgOrder: percent(a.averageOrderValue, b.averageOrderValue),
  };
}

export function summarizeDateBucket(sales: DaySales[], date: Date, filters: AnalyticsFilters) {
  const day = sales.find((d) => isSameDay(new Date(`${d.dateKey}T00:00:00`), date));
  const tx = day ? applyFilters(day.transactions, filters) : [];
  return {
    amount: tx.reduce((sum, t) => sum + t.amount, 0),
    transactions: tx.length,
  };
}
