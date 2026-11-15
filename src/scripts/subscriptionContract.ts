// Records or checks the response shape (field names + types, never values) of the read-only subscription v1 endpoints.
// Usage: CONTRACT_ADMIN_TOKEN=<jwt> CONTRACT_SUPERADMIN_TOKEN=<jwt> npx tsx src/scripts/subscriptionContract.ts --record|--check
import fs from 'fs';
import path from 'path';

type Shape = string | { [key: string]: Shape };
type Role = 'admin' | 'superadmin';
interface Call {
  name: string;
  role: Role;
  method: 'GET' | 'POST';
  path: string;
  body?: () => unknown;
}

const BASE = process.env.CONTRACT_BASE_URL ?? 'http://localhost:5000';
const TOKENS: Record<Role, string | undefined> = {
  admin: process.env.CONTRACT_ADMIN_TOKEN,
  superadmin: process.env.CONTRACT_SUPERADMIN_TOKEN,
};
const OUT_DIR = path.join(__dirname, '../main/subscription/__tests__/contract');
const mode = process.argv.includes('--record')
  ? 'record'
  : process.argv.includes('--check')
    ? 'check'
    : null;
const say = (...m: unknown[]) => console.info(...m);

// Filled from the plan and add-on lists so the POST quotes have real ids.
const picked: { paidPlanId?: string; freePlanId?: string; addOnId?: string } = {
  paidPlanId: process.env.CONTRACT_PLAN_ID,
  addOnId: process.env.CONTRACT_ADDON_ID,
};

const CALLS: Call[] = [
  { name: 'plans', role: 'admin', method: 'GET', path: '/plans' },
  {
    name: 'my-subscription',
    role: 'admin',
    method: 'GET',
    path: '/my-subscription',
  },
  { name: 'activity', role: 'admin', method: 'GET', path: '/activity' },
  {
    name: 'billing-history',
    role: 'admin',
    method: 'GET',
    path: '/billing-history',
  },
  {
    name: 'auto-renew-status',
    role: 'admin',
    method: 'GET',
    path: '/auto-renew/status',
  },
  {
    name: 'auto-renew-preview',
    role: 'admin',
    method: 'GET',
    path: '/auto-renew/preview',
  },
  {
    name: 'addons-available',
    role: 'admin',
    method: 'GET',
    path: '/addons/available',
  },
  {
    name: 'limitations-overview',
    role: 'admin',
    method: 'GET',
    path: '/limitations/overview',
  },
  {
    name: 'plan-quote',
    role: 'admin',
    method: 'POST',
    path: '/quote',
    body: () => ({ planId: picked.paidPlanId, billingCycle: 'monthly' }),
  },
  {
    name: 'addons-quote',
    role: 'admin',
    method: 'POST',
    path: '/addons/quote',
    body: () => ({
      addOns: [
        { addOnId: picked.addOnId, billingCycle: 'monthly', quantity: 1 },
      ],
    }),
  },
  {
    name: 'check-downgrade',
    role: 'admin',
    method: 'POST',
    path: '/check-downgrade',
    body: () => ({ targetPlanId: picked.freePlanId }),
  },
  {
    name: 'superadmin-plan-limits',
    role: 'superadmin',
    method: 'GET',
    path: '/plan-limits/',
  },
  {
    name: 'superadmin-coupons',
    role: 'superadmin',
    method: 'GET',
    path: '/coupons',
  },
  {
    name: 'superadmin-addons-active',
    role: 'superadmin',
    method: 'GET',
    path: '/addons/active',
  },
];

function shapeOf(value: unknown): Shape {
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    return value.length === 0
      ? { '[]': 'empty' }
      : { '[]': value.map(shapeOf).reduce(mergeShapes) };
  }
  if (typeof value === 'object') {
    const out: { [key: string]: Shape } = {};
    for (const key of Object.keys(value as object).sort()) {
      out[key] = shapeOf((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return typeof value;
}

// Array items can differ (e.g. a nullable field); keep every key and every type seen.
function mergeShapes(a: Shape, b: Shape): Shape {
  // ponytail: a field that is null in some items keeps the object's fields; nullability is not recorded.
  if (a === 'null' && typeof b === 'object') return b;
  if (b === 'null' && typeof a === 'object') return a;
  if (typeof a === 'string' || typeof b === 'string') {
    if (a === b) return a;
    const parts = new Set(
      [a, b].flatMap((s) => (typeof s === 'string' ? s.split('|') : ['object']))
    );
    return [...parts].sort().join('|');
  }
  const out: { [key: string]: Shape } = {};
  for (const key of [
    ...new Set([...Object.keys(a), ...Object.keys(b)]),
  ].sort()) {
    out[key] =
      key in a && key in b ? mergeShapes(a[key], b[key]) : (a[key] ?? b[key]);
  }
  return out;
}

function flatten(shape: Shape, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  if (typeof shape === 'string') {
    out.set(prefix || '(root)', shape);
    return out;
  }
  for (const [key, child] of Object.entries(shape)) {
    const next =
      key === '[]' ? `${prefix}[]` : prefix ? `${prefix}.${key}` : key;
    for (const [p, t] of flatten(child, next)) out.set(p, t);
  }
  return out;
}

function findIds(data: unknown): void {
  const items = Array.isArray(data)
    ? data
    : ((data as Record<string, unknown>)?.plans ??
      (data as Record<string, unknown>)?.addOns ??
      []);
  if (!Array.isArray(items)) return;
  for (const item of items as Record<string, unknown>[]) {
    const slug = String(item.slug ?? '').toLowerCase();
    if (slug && (slug === 'solo' || slug === 'free')) {
      picked.freePlanId ??= String(item.id);
    } else if (slug && item.id) {
      picked.paidPlanId ??= String(item.id);
    } else if (!slug && item.id && 'featureKey' in item) {
      picked.addOnId ??= String(item.id);
    }
  }
}

async function run(call: Call): Promise<Shape> {
  const token = TOKENS[call.role];
  if (!token)
    throw new Error(`CONTRACT_${call.role.toUpperCase()}_TOKEN is not set`);
  const res = await fetch(`${BASE}/api/v1/subscription${call.path}`, {
    method: call.method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: call.body ? JSON.stringify(call.body()) : undefined,
  });
  const json = (await res.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!res.ok || !json) {
    throw new Error(
      `${call.method} ${call.path} → ${res.status} ${json?.message ?? ''}`
    );
  }
  if (call.name === 'plans' || call.name === 'addons-available')
    findIds(json.data);
  return shapeOf(json);
}

async function main() {
  if (!mode) throw new Error('Pass --record or --check');
  if (mode === 'record') fs.mkdirSync(OUT_DIR, { recursive: true });
  let broken = 0;

  for (const call of CALLS) {
    const file = path.join(OUT_DIR, `${call.name}.shape.json`);
    let shape: Shape;
    try {
      shape = await run(call);
    } catch (error) {
      broken++;
      say(`✗ ${call.name}: ${(error as Error).message}`);
      continue;
    }

    if (mode === 'record') {
      fs.writeFileSync(file, `${JSON.stringify(shape, null, 2)}\n`);
      say(`✓ ${call.name}: recorded`);
      continue;
    }

    if (!fs.existsSync(file)) {
      broken++;
      say(`✗ ${call.name}: no recorded shape — run --record first`);
      continue;
    }
    const before = flatten(JSON.parse(fs.readFileSync(file, 'utf8')) as Shape);
    const now = flatten(shape);
    // An empty list or a null value in either run says nothing about what sits under it, so skip those paths.
    const holes = [...before, ...now]
      .filter(([, t]) => t === 'empty' || t === 'null')
      .map(([p]) => p);
    const unknown = (p: string) =>
      holes.some(
        (h) => p === h || p.startsWith(`${h}.`) || p.startsWith(`${h}[]`)
      );
    const removed = [...before.keys()].filter(
      (p) => !now.has(p) && !unknown(p)
    );
    const changed = [...before.keys()].filter(
      (p) =>
        now.has(p) &&
        now.get(p) !== before.get(p) &&
        !(before.get(p) ?? '').includes('null') &&
        !(now.get(p) ?? '').includes('null')
    );
    const added = [...now.keys()].filter((p) => !before.has(p));
    if (removed.length || changed.length) broken++;
    say(
      `${removed.length || changed.length ? '✗' : '✓'} ${call.name}` +
        (removed.length ? `\n    removed: ${removed.join(', ')}` : '') +
        (changed.length
          ? `\n    type changed: ${changed.map((p) => `${p} ${before.get(p)} → ${now.get(p)}`).join(', ')}`
          : '') +
        (added.length ? `\n    added (ok): ${added.join(', ')}` : '')
    );
  }

  say(broken ? `\n${broken} endpoint(s) need attention` : '\nAll shapes match');
  process.exit(broken ? 1 : 0);
}

main().catch((error) => {
  console.error('subscriptionContract failed:', error);
  process.exit(1);
});
