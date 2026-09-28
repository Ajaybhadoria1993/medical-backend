export type CustomValueType = 'number' | 'currency' | 'percentage' | 'text';

export interface CustomColumn {
  key: string;
  label: string;
  type: CustomValueType;
  align: 'left' | 'right';
}

export interface CustomCatalogMetric {
  id: string;
  label: string;
  category: string;
  type: CustomValueType;
}

export interface CustomCatalogDimension {
  id: string;
  label: string;
}

export interface CustomCatalogFilterOption {
  label: string;
  value: string;
}

export interface CustomCatalogFilter {
  id: string;
  label: string;
  type: 'select' | 'multiselect' | 'lookup';
  options?: CustomCatalogFilterOption[];
}

export interface CustomCatalogDataSource {
  id: string;
  label: string;
  metrics: CustomCatalogMetric[];
  dimensions: CustomCatalogDimension[];
  filters: CustomCatalogFilter[];
}

export interface CustomReportSchema {
  dataSources: CustomCatalogDataSource[];
}

export interface CustomReportRow {
  [key: string]: string | number;
}

export interface CustomReportResult {
  columns: CustomColumn[];
  rows: CustomReportRow[];
  totals: CustomReportRow;
  pagination: {
    page: number;
    pageSize: number;
    totalRows: number;
    totalPages: number;
  };
  appliedDefinition: {
    dataSource: string;
    metrics: string[];
    groupBy: string;
    thenBy?: string;
    sortBy: string;
    sortDirection: 'asc' | 'desc';
  };
}
