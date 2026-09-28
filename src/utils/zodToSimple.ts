/* eslint-disable @typescript-eslint/no-explicit-any */
// src/utils/zodToSimple.ts
import type { ZodType } from 'zod';
import { ZodTuple, ZodEnum, ZodArray, ZodUnion, ZodRecord } from 'zod';

function kindOf(schema: ZodType | any): string {
  const typeName =
    schema && schema.def && schema.def.typeName
      ? schema.def.typeName
      : schema && schema.type
        ? schema.type
        : 'Unknown';
  console.debug(`[zodToSimple] Processing schema type: ${typeName}`);
  return typeName;
}

function getInner(schema: any): any {
  if (!schema || !schema.def) {
    console.warn(
      '[zodToSimple] No def property found on schema:',
      JSON.stringify(schema, null, 2)
    );
    return null;
  }
  return schema.def.innerType ?? schema.def.schema ?? schema.def.type ?? null;
}

function getChecks(schema: any): any[] {
  return (schema && schema.def && schema.def.checks) || [];
}

function getShape(schema: any): any {
  if (!schema || !schema.def) {
    console.warn(
      '[zodToSimple] No def property found on schema:',
      JSON.stringify(schema, null, 2)
    );
    return {};
  }
  const shape =
    typeof schema.def.shape === 'function'
      ? schema.def.shape()
      : schema.def.shape || {};
  if (!shape || typeof shape !== 'object') {
    console.warn(
      '[zodToSimple] Invalid shape for schema:',
      JSON.stringify(schema, null, 2)
    );
    return {};
  }
  return shape;
}

export function zodToSimple(schema: ZodType | null | undefined): any {
  if (!schema) {
    console.warn('[zodToSimple] Received null or undefined schema');
    return { type: 'any' };
  }

  const kind = kindOf(schema);

  if (kind === 'ZodOptional' || kind === 'ZodDefault') {
    const inner = getInner(schema);
    const simple = zodToSimple(inner);
    if (simple && typeof simple === 'object') simple.optional = true;
    return simple;
  }

  if (kind === 'ZodNullable') {
    const inner = getInner(schema);
    const simple = zodToSimple(inner);
    if (simple && typeof simple === 'object') simple.nullable = true;
    return simple;
  }

  if (kind === 'ZodEffects') {
    const inner = getInner(schema);
    if (inner) {
      console.debug('[zodToSimple] Unwrapping ZodEffects to inner schema');
      return zodToSimple(inner);
    }
    console.warn('[zodToSimple] ZodEffects with no inner schema');
    return { type: 'any' };
  }

  if (kind === 'ZodString') {
    const out: any = { type: 'string' };
    const checks = getChecks(schema);
    for (const c of checks) {
      if (c.kind === 'min') out.minLength = c.value;
      if (c.kind === 'max') out.maxLength = c.value;
      if (c.kind === 'email') out.format = 'email';
      if (c.kind === 'uuid') out.format = 'uuid';
      if (c.kind === 'url') out.format = 'url';
      if (c.kind === 'regex') out.pattern = String(c.regex);
    }
    return out;
  }

  if (kind === 'ZodNumber') {
    const out: any = { type: 'number' };
    const checks = getChecks(schema);
    for (const c of checks) {
      if (c.kind === 'min') out.minValue = c.value;
      if (c.kind === 'max') out.maxValue = c.value;
      if (c.kind === 'int') out.isInt = true;
    }
    return out;
  }

  if (kind === 'ZodBoolean') {
    return { type: 'boolean' };
  }

  if (kind === 'ZodLiteral') {
    return { type: 'literal', value: (schema as any).value };
  }

  if (kind === 'ZodEnum') {
    const enumSchema = schema as ZodEnum<any>;
    return { type: 'enum', options: enumSchema.options ?? [] };
  }

  if (kind === 'ZodNativeEnum') {
    const enumSchema = schema as ZodEnum<any>;
    const raw = enumSchema.enum ?? {};
    let opts: any[] = Array.isArray(raw) ? raw : Object.values(raw);
    opts = Array.from(new Set(opts));
    return { type: 'enum', options: opts };
  }

  if (kind === 'ZodArray') {
    const arraySchema = schema as ZodArray<any>;
    const item = arraySchema.element ?? null;
    if (!item) {
      console.warn('[zodToSimple] ZodArray with no item type');
      return { type: 'array', items: { type: 'any' } };
    }
    return { type: 'array', items: zodToSimple(item) };
  }

  if (kind === 'ZodTuple') {
    const tupleSchema = schema as ZodTuple<any>;
    const items = tupleSchema.def?.items ?? [];
    return { type: 'tuple', items: items.map((it: any) => zodToSimple(it)) };
  }

  if (kind === 'ZodUnion') {
    const unionSchema = schema as ZodUnion<any>;
    const opts = unionSchema.options ?? [];
    return { type: 'union', anyOf: opts.map((o: any) => zodToSimple(o)) };
  }

  if (kind === 'ZodRecord') {
    const recordSchema = schema as ZodRecord<any, any>;
    const valueType = recordSchema.valueType ?? null;
    return { type: 'record', values: zodToSimple(valueType) };
  }

  if (kind === 'object' || kind === 'ZodObject') {
    const shape = getShape(schema);
    const props: Record<string, any> = {};
    const required: string[] = [];

    for (const key of Object.keys(shape)) {
      const pschema = shape[key];
      if (!pschema) {
        console.warn(`[zodToSimple] No schema for object property ${key}`);
        props[key] = { type: 'any' };
        continue;
      }
      const simple = zodToSimple(pschema);
      props[key] = simple;
      const pKind = kindOf(pschema);
      const isOptional = pKind === 'ZodOptional' || pKind === 'ZodDefault';
      if (!isOptional) required.push(key);
    }
    return { type: 'object', properties: props, required };
  }

  console.warn(
    `[zodToSimple] Unhandled schema type: ${kind}`,
    JSON.stringify(schema, null, 2)
  );
  return { type: 'any' };
}
