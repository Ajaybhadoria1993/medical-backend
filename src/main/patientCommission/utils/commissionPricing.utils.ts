import type {
  CommissionPricing,
  CommissionTier,
  PricingSource,
  PricingVersionRow,
} from '../types/patientCommission.types';

export const MAX_TIERS = 10;

/** Applies to every clinic with no pricing of its own and until Super Admin saves a platform default. */
export const DEFAULT_COMMISSION_PRICING: CommissionPricing = {
  periodKind: 'monthly',
  tiers: [
    { fromPatients: 0, ratePaise: 1000 },
    { fromPatients: 500, ratePaise: 800 },
    { fromPatients: 1000, ratePaise: 600 },
  ],
};

/** A copy of the tiers in ascending order of `fromPatients`. */
export function sortedTiers(tiers: CommissionTier[]): CommissionTier[] {
  return [...tiers].sort((a, b) => a.fromPatients - b.fromPatients);
}

/** The price per patient once a period has `patients` patients; the tier reached sets it for all of them. */
export function rateForPatients(
  tiers: CommissionTier[],
  patients: number
): number {
  const ordered = sortedTiers(tiers);
  let rate = ordered[0]?.ratePaise ?? 0;
  for (const tier of ordered) {
    if (patients >= tier.fromPatients) rate = tier.ratePaise;
  }
  return rate;
}

/** The next tier above `patients` and how many more patients reach it; null on the last tier. */
export function nextTierAfter(
  tiers: CommissionTier[],
  patients: number
): { atPatients: number; ratePaise: number; remaining: number } | null {
  const next = sortedTiers(tiers).find((t) => t.fromPatients > patients);
  return next
    ? {
        atPatients: next.fromPatients,
        ratePaise: next.ratePaise,
        remaining: next.fromPatients - patients,
      }
    : null;
}

/** The newest row whose `effectiveFrom` has passed at `at`; null if none has. */
export function latestVersionAt(
  rows: PricingVersionRow[],
  at: Date
): PricingVersionRow | null {
  let best: PricingVersionRow | null = null;
  for (const row of rows) {
    if (row.effectiveFrom > at) continue;
    if (!best || row.effectiveFrom > best.effectiveFrom) best = row;
  }
  return best;
}

const asPricing = (row: PricingVersionRow | null): CommissionPricing | null =>
  row?.periodKind && row.tiers?.length
    ? { periodKind: row.periodKind, tiers: sortedTiers(row.tiers) }
    : null;

/** The pricing in force at `at`: the clinic's own if its newest row sets one, else the platform default. */
export function resolvePricing(
  clinicRows: PricingVersionRow[],
  defaultRows: PricingVersionRow[],
  at: Date
): { pricing: CommissionPricing; source: PricingSource } {
  const own = asPricing(latestVersionAt(clinicRows, at));
  if (own) return { pricing: own, source: 'clinic' };
  const platform = asPricing(latestVersionAt(defaultRows, at));
  return { pricing: platform ?? DEFAULT_COMMISSION_PRICING, source: 'default' };
}
