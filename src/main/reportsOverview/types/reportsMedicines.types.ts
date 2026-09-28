export interface MedicineMetricItem {
  value: number;
  change: number;
  changeType: 'increase' | 'decrease' | 'neutral' | 'new';
}

export interface MedicineMetrics {
  totalMedicines: MedicineMetricItem;
  unitsSold: MedicineMetricItem;
  salesAmount: MedicineMetricItem;
  grossProfit: MedicineMetricItem;
  lowStockItems: MedicineMetricItem;
  expiringItems: MedicineMetricItem;
}

export interface MedicineTrend {
  labels: string[];
  currentPeriod: number[];
  previousPeriod: number[];
}

export interface MedicineDistributionItem {
  label: string;
  value: number;
  percentage: number;
}

export interface TopSellingMedicineItem {
  medicineName: string;
  unitsSold: number;
  salesAmount: number;
}

export interface LowStockMedicineItem {
  medicineName: string;
  currentStock: number;
  reorderLevel: number;
}

export interface ExpiringSoonItem {
  medicineName: string;
  batch: string;
  expiryDate: string;
  daysLeft: number;
  quantity: number;
}

export interface TopSupplierItem {
  supplierId: string;
  supplierName: string;
  purchaseAmount: number;
  percentage: number;
}

export interface InventoryMovementBucket {
  count: number;
  percentage: number;
}

export interface InventorySummary {
  totalStockValue: number;
  totalStockUnits: number;
  fastMoving: InventoryMovementBucket;
  slowMoving: InventoryMovementBucket;
  deadStock: InventoryMovementBucket;
}

export interface ReportsMedicinesData {
  metrics: MedicineMetrics;
  salesTrend: MedicineTrend;
  salesByCategory: MedicineDistributionItem[];
  salesByFormulation: MedicineDistributionItem[];
  topSellingMedicines: TopSellingMedicineItem[];
  lowStockMedicines: LowStockMedicineItem[];
  expiringSoon: ExpiringSoonItem[];
  topSuppliers: TopSupplierItem[];
  inventorySummary: InventorySummary;
  insights: string[];
}
