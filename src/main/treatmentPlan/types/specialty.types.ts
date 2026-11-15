export type FieldType =
  'text' | 'number' | 'select' | 'multiselect' | 'date' | 'boolean';

/** One extra field a specialty asks for, e.g. tooth number. */
export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  options?: string[];
  unit?: string;
  min?: number;
  max?: number;
  required: boolean;
}

export type SpecialtyValue = string | number | boolean | string[] | null;

export type SpecialtyData = Record<string, SpecialtyValue>;
