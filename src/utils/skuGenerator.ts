export const FORM_MAP: Record<string, string> = {
  TABLET: 'TAB',
  CAPSULE: 'CAP',
  SYRUP: 'SYR',
  INJECTION: 'INJ',
};

export function shortDrug(name: string) {
  return name
    .replace(/[^A-Z]/gi, '')
    .toUpperCase()
    .slice(0, 4);
}

export function normalizeStrength(str?: string | null) {
  return str ? str.replace(/\s+/g, '').toUpperCase() : 'NA';
}

export function generateSku(data: {
  drugName: string;
  strength?: string | null;
  categoryName?: string | null;
}) {
  const formCode = FORM_MAP[data.categoryName?.toUpperCase() ?? ''] ?? 'GEN';
  const drugCode = shortDrug(data.drugName);
  const strengthCode = normalizeStrength(data.strength);

  return `${formCode}-${drugCode}-${strengthCode}`;
}
