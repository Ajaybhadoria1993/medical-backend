// Moves coupons off retired values: trial → 100% off and inactive, expired → inactive, specific_* → plans/addons.
// Usage: NODE_ENV=<env> npx tsx src/scripts/cleanupCoupons.ts [--apply] (dry run by default); safe to rerun.
import { eq, inArray, or, sql } from 'drizzle-orm';
import { database } from '../configurations/dbConnection';
import { CouponModel } from '../main/subscription/models/coupon.model';

const apply = process.argv.includes('--apply');
const say = (...m: unknown[]) => console.info(...m);
class DryRun extends Error {}

async function main() {
  say(apply ? 'APPLY: converting coupons' : 'DRY RUN: nothing will be written');
  const rows = await database
    .select()
    .from(CouponModel)
    .where(
      or(
        eq(CouponModel.discountType, 'trial'),
        eq(CouponModel.status, 'expired'),
        inArray(CouponModel.appliesTo, ['specific_plans', 'specific_addons']),
        sql`${CouponModel.discountType} = 'percentage' and ${CouponModel.discountValue} > 100`
      )
    );

  const changes = rows.map((c) => {
    const set: Partial<typeof CouponModel.$inferInsert> = {};
    const why: string[] = [];
    if (c.discountType === 'trial') {
      // Super Admin decides whether a free payment is still wanted, so it starts switched off.
      Object.assign(set, {
        discountType: 'percentage',
        discountValue: '100',
        maxDiscountAmount: null,
        trialDays: null,
        status: 'inactive',
      });
      why.push('trial → 100% off, inactive');
    } else if (
      c.discountType === 'percentage' &&
      Number(c.discountValue) > 100
    ) {
      set.discountValue = '100';
      why.push(`${c.discountValue}% → 100%`);
    }
    if (c.status === 'expired') {
      set.status = 'inactive';
      why.push('expired → inactive');
    }
    if (c.appliesTo === 'specific_plans') {
      set.appliesTo = 'plans';
      why.push('specific_plans → plans + list');
    }
    if (c.appliesTo === 'specific_addons') {
      set.appliesTo = 'addons';
      why.push('specific_addons → addons + list');
    }
    return { id: c.id, code: c.code, set, why };
  });

  try {
    await database.transaction(async (tx) => {
      for (const c of changes) {
        await tx
          .update(CouponModel)
          .set({ ...c.set, updatedAt: new Date() })
          .where(eq(CouponModel.id, c.id));
      }
      if (!apply) throw new DryRun();
    });
  } catch (e) {
    if (!(e instanceof DryRun)) throw e;
  }

  say(`\nCoupons ${apply ? 'converted' : 'to convert'}: ${changes.length}`);
  changes.forEach((c) => say(`  ${c.code}: ${c.why.join('; ')}`));
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
