/**
 * Test script to send a renewal reminder email using real DB data.
 * Run with: npx tsx src/scripts/testRenewalEmail.ts
 */
import 'dotenv/config';
import { and, eq } from 'drizzle-orm';
import { database, pgDbConnection } from '../configurations/dbConnection';
import {
  AddOnInfo,
  subscriptionRenewalTemplate,
} from '../htmltamplates/subscriptionRenewal';
import { ClinicModel } from '../main/clinic/models/clinic.model';
import {
  AddOnModel,
  ClinicAddOnModel,
} from '../main/subscription/models/addon.model';
import {
  ClinicSubscriptionModel,
  SubscriptionPlanModel,
} from '../main/subscription/models/subscription.model';
import { LimitationService } from '../main/subscription/services/limitation.service';
import { UserModel } from '../main/users/models/user.model';
import { sendEmail } from '../utils/email';

const TEST_EMAIL = 'harshitsharma@igtechso.com';

async function main() {
  await pgDbConnection();

  const [admin] = await database
    .select({
      id: UserModel.id,
      name: UserModel.name,
      email: UserModel.email,
    })
    .from(UserModel)
    .where(eq(UserModel.email, TEST_EMAIL))
    .limit(1);

  if (!admin) {
    console.error(`❌ User not found: ${TEST_EMAIL}`);
    process.exit(1);
  }

  console.info(`Found admin: ${admin.name} (${admin.email})`);

  const [clinic] = await database
    .select({
      id: ClinicModel.id,
      clinicName: ClinicModel.clinicName,
    })
    .from(ClinicModel)
    .where(eq(ClinicModel.userId, admin.id))
    .limit(1);

  if (!clinic) {
    console.error(`❌ No clinic found for user: ${admin.id}`);
    process.exit(1);
  }

  console.info(`Found clinic: ${clinic.clinicName} (${clinic.id})`);

  const [sub] = await database
    .select({
      id: ClinicSubscriptionModel.id,
      planId: ClinicSubscriptionModel.planId,
      expiresAt: ClinicSubscriptionModel.expiresAt,
      providerSubscriptionId: ClinicSubscriptionModel.providerSubscriptionId,
      planName: SubscriptionPlanModel.name,
      planPrice: SubscriptionPlanModel.price,
      planSlug: SubscriptionPlanModel.slug,
    })
    .from(ClinicSubscriptionModel)
    .innerJoin(
      SubscriptionPlanModel,
      eq(ClinicSubscriptionModel.planId, SubscriptionPlanModel.id)
    )
    .where(
      and(
        eq(ClinicSubscriptionModel.clinicId, clinic.id),
        eq(ClinicSubscriptionModel.active, true)
      )
    )
    .limit(1);

  if (!sub) {
    console.error(`❌ No active subscription for clinic: ${clinic.id}`);
    process.exit(1);
  }

  console.info(
    `Subscription: ${sub.planName} (${sub.planSlug}), expires: ${sub.expiresAt || 'never'}`
  );

  const billingCycle =
    sub.providerSubscriptionId === 'pro-yearly' ? 'yearly' : 'monthly';
  const basePlanPrice =
    billingCycle === 'yearly'
      ? Math.round(Number(sub.planPrice) * 12 * 0.9)
      : Number(sub.planPrice);

  const clinicAddOns = await database
    .select({
      addOnName: AddOnModel.name,
      quantity: ClinicAddOnModel.quantity,
      price: ClinicAddOnModel.price,
    })
    .from(ClinicAddOnModel)
    .innerJoin(AddOnModel, eq(ClinicAddOnModel.addOnId, AddOnModel.id))
    .where(
      and(
        eq(ClinicAddOnModel.clinicId, clinic.id),
        eq(ClinicAddOnModel.isActive, true)
      )
    );

  const addOns: AddOnInfo[] = clinicAddOns.map((a) => ({
    name: a.addOnName,
    quantity: a.quantity,
    price: Number(a.price),
  }));

  const addOnTotal = addOns.reduce((sum, a) => sum + a.price, 0);
  const totalAmount = basePlanPrice + addOnTotal;

  const doctorCheck = await LimitationService.checkDoctorLimit(clinic.id);
  const staffCheck = await LimitationService.checkStaffLimit(clinic.id);

  const now = new Date();
  const daysRemaining = sub.expiresAt
    ? Math.max(
        1,
        Math.ceil(
          (new Date(sub.expiresAt).getTime() - now.getTime()) /
            (1000 * 60 * 60 * 24)
        )
      )
    : 3;

  const expiresAt = sub.expiresAt
    ? new Date(sub.expiresAt)
    : new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);

  console.info(
    `Pricing: Plan ${sub.planName} — ₹${basePlanPrice}/${billingCycle} | Add-ons: ₹${addOnTotal} | Total: ₹${totalAmount}`
  );
  console.info(
    `Usage: Doctors ${doctorCheck.currentUsage}/${doctorCheck.limit ?? '∞'} | Staff ${staffCheck.currentUsage}/${staffCheck.limit ?? '∞'}`
  );
  console.info(`Days remaining: ${daysRemaining}`);

  const renewalUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/subscription/renew?planId=${sub.planId}&cycle=${billingCycle}&clinicId=${clinic.id}`;

  const emailHtml = subscriptionRenewalTemplate({
    adminName: admin.name || 'Admin',
    clinicName: clinic.clinicName,
    planName: sub.planName,
    planPrice: basePlanPrice,
    billingCycle,
    addOns,
    totalAmount,
    expiresAt,
    daysRemaining,
    renewalUrl,
    staffCount: staffCheck.currentUsage,
    doctorCount: doctorCheck.currentUsage,
    staffLimit: 1,
    doctorLimit: 2,
  });

  console.info(`Sending email to: ${admin.email}...`);

  try {
    await sendEmail(
      admin.email!,
      `Infinity Medisetu - Your ${sub.planName} Plan Expires in ${daysRemaining} Day(s) at ${clinic.clinicName}`,
      emailHtml
    );
    console.info('✅ Email sent successfully!');
  } catch (err) {
    console.error('❌ Failed to send email:', err);
  }

  process.exit(0);
}

main();
