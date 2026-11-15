// Every signed-in route names its roles (BE §3); reads the route files, so no server is needed.
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

const MAIN = join(__dirname, '../../main');
// Lab and pharmacy are reviewed separately.
const SKIP_MODULES = ['pharmacies', 'pharmacy', 'lab', 'test'];
// Called by every role, the patient app included; @access should say "any authenticated user".
const ANY_ROLE = [
  /^\/notifications/,
  /^\/realtime/,
  /^\/permissions\/me$/,
  /^\/subscription\/limitations\/overview$/,
  /^\/appointments\/all\/user$/,
  /^\/banners\/(eligible(\/all)?|:bannerId\/(dismiss|track)|track-batch)$/,
  /^\/doctor\/(specialties|colleges)$/,
  /^\/cancellation-policy\/reasons$/,
  /^\/files\/(sign|download)$/,
  /^\/global\/upi\/lookup$/,
  /^\/appointments\/get-doctor-gallery-by-specialty$/,
  /^\/calls\/active$/,
];
const GUARDS =
  /requireRole\(|requireSuperAdmin|requireDoctor\b|requirePatient\b|requireReceptionist\b|requireUser\b|requirePharmacist\b|requireLabAssistant\b|apiKeyAuth/;

const routeFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory()
      ? routeFiles(p)
      : f.endsWith('.route.ts')
        ? [p]
        : [];
  });

const kebab = (s: string) =>
  s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

const unguarded = routeFiles(MAIN).flatMap((file) => {
  const parts = relative(MAIN, file).split(/[\\/]/);
  const [feature] = parts;
  const name = parts[parts.length - 1];
  if (SKIP_MODULES.includes(feature)) return [];
  const base = name.replace('.route.ts', '');
  const mount =
    base === feature ? `/${kebab(feature)}` : `/${feature}/${kebab(base)}`;
  const code = readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  const fileGuards = [...code.matchAll(/\w+\.use\(([^;]*?)\);/g)]
    .map((m) => m[1])
    .join(' ');
  const consts = [
    ...code.matchAll(/const \w+\s*=\s*(\[[\s\S]*?\]|requireRole\([^;]*?\));/g),
  ]
    .map((m) => m[1])
    .join(' ');
  return [
    ...code.matchAll(
      /\w+\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]*)['"`]([\s\S]*?)\n\);/g
    ),
  ]
    .filter(([, , , body]) => /requireAuth/.test(fileGuards + body))
    .map(([, method, path, body]) => ({
      route: `${method.toUpperCase()} ${mount}${path === '/' ? '' : path}`,
      body,
    }))
    .filter(({ route, body }) => {
      const path = route.split(' ')[1];
      if (ANY_ROLE.some((r) => r.test(path))) return false;
      // requireAdmin alone is not a role guard: it admits Patient too.
      const named = (fileGuards + body + consts).replace(
        /\brequireAdmin\b/g,
        ''
      );
      return (
        !GUARDS.test(named) ||
        (/\brequireAdmin\b/.test(body) &&
          !GUARDS.test(body.replace(/\brequireAdmin\b/g, '')))
      );
    })
    .map(({ route }) => `${relative(MAIN, file)}: ${route}`);
});

describe('route roles', () => {
  it('every signed-in route outside lab / pharmacy names its roles', () => {
    expect(unguarded).toEqual([]);
  });
});
