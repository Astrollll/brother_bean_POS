export type PaymentMethod = "Cash" | "GCash" | "Card";

export interface SaleTransaction {
  id: string;
  createdAt: string;
  amount: number;
  paymentMethod: PaymentMethod;
  staff: string;
  category: string;
  itemName: string;
  quantity: number;
}

export interface DaySales {
  dateKey: string;
  transactions: SaleTransaction[];
}

export interface SalesPeriod {
  start: Date;
  end: Date;
  label: string;
}

export interface PeriodMetrics {
  totalSales: number;
  transactionCount: number;
  averageOrderValue: number;
  bestSeller: string;
  paymentBreakdown: Record<PaymentMethod, number>;
  hourlyTotals: Array<{ hour: number; total: number; orders: number }>;
  categoryTotals: Record<string, number>;
  productTotals: Record<string, number>;
}

export interface AnalyticsFilters {
  staff: string;
  paymentMethod: "all" | PaymentMethod;
  category: string;
}

export interface SavedPreset {
  id: string;
  name: string;
  periodA: { start: string; end: string; label: string };
  periodB: { start: string; end: string; label: string };
}
