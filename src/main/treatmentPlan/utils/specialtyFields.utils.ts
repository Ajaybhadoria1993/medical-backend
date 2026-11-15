import { z } from 'zod';
import type { FieldDef } from '../types/specialty.types';

function fieldSchema(f: FieldDef): z.ZodType {
  const unit = f.unit ? ` ${f.unit}` : '';
  switch (f.type) {
    case 'number': {
      let n = z.number({ error: `${f.label}: enter a number` });
      if (f.min !== undefined)
        n = n.min(f.min, `${f.label}: enter at least ${f.min}${unit}`);
      if (f.max !== undefined)
        n = n.max(f.max, `${f.label}: enter at most ${f.max}${unit}`);
      return n;
    }
    case 'select':
      return z.enum(f.options ?? [], {
        error: `${f.label}: choose one of the listed options`,
      });
    case 'multiselect':
      return z.array(
        z.enum(f.options ?? [], {
          error: `${f.label}: choose from the listed options`,
        })
      );
    case 'date':
      return z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, `${f.label}: enter a date`);
    case 'boolean':
      return z.boolean({ error: `${f.label}: choose yes or no` });
    default:
      return z.string().trim().max(200, `${f.label}: 200 characters at most`);
  }
}

/** Validator for `specialty_data` built from a specialty's field definitions (DEV_PLAN §3.6). */
export function buildSpecialtyDataSchema(fields: FieldDef[]) {
  const shape: Record<string, z.ZodType> = {};
  for (const f of fields) {
    const base = fieldSchema(f);
    shape[f.key] = f.required ? base : base.nullable().optional();
  }
  return z.object(shape).strict();
}
