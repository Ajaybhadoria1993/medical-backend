// Primary export point for subscription models

// Core models to keep
export {
  SubscriptionPlanModel,
  ClinicSubscriptionModel,
  ownerTypeEnum,
  planKindEnum,
} from './subscription.model';
export { PlanVersionModel } from './planVersion.model';
export type { PlanVersion, NewPlanVersion } from './planVersion.model';
export { BillingTaxRateModel, billingTaxModeEnum } from './taxRate.model';
export type { BillingTaxRate, BillingTaxMode } from './taxRate.model';
export {
  SubscriptionModel,
  SubscriptionAddOnModel,
  subscriptionStatusEnum,
  subscriptionBillingCycleEnum,
  subscriptionAddOnStatusEnum,
} from './ownerSubscription.model';
export type {
  Subscription,
  NewSubscription,
  SubscriptionAddOn,
  NewSubscriptionAddOn,
} from './ownerSubscription.model';
export {
  SubscriptionPaymentModel,
  SubscriptionInvoiceModel,
  SubscriptionInvoiceSequenceModel,
  SubscriptionCreditNoteModel,
  subscriptionPaymentKindEnum,
  subscriptionPaymentStatusEnum,
  subscriptionInvoiceStatusEnum,
} from './subscriptionPayment.model';
export type {
  SubscriptionPayment,
  NewSubscriptionPayment,
  SubscriptionInvoice,
  NewSubscriptionInvoice,
} from './subscriptionPayment.model';
export {
  SubscriptionMandateModel,
  subscriptionMandateMethodEnum,
  subscriptionMandateStatusEnum,
} from './subscriptionMandate.model';
export type {
  SubscriptionMandate,
  NewSubscriptionMandate,
} from './subscriptionMandate.model';
export {
  SubscriptionWebhookEventModel,
  subscriptionWebhookEventStatusEnum,
} from './subscriptionWebhookEvent.model';
export type {
  SubscriptionWebhookEvent,
  NewSubscriptionWebhookEvent,
} from './subscriptionWebhookEvent.model';
export type {
  SubscriptionPlan,
  NewSubscriptionPlan,
  ClinicSubscription,
  NewClinicSubscription,
} from './subscription.model';

// Add-on models
export {
  AddOnModel,
  ClinicAddOnModel,
  PlanAddOnLimitsModel,
} from './addon.model';
export type { AddOn, ClinicAddOn, PlanAddOnLimit } from './addon.model';
export { AddOnPriceModel, addOnPriceNow } from './addOnPrice.model';
export type { AddOnPrice } from './addOnPrice.model';

// Usage tracking
export { ClinicUsageModel } from './clinicUsage.model';

// Super Admin's per-clinic free-trial length
export { ClinicTrialOverrideModel } from './clinicTrialOverride.model';
export type { ClinicTrialOverride } from './clinicTrialOverride.model';

// Unified features/limits model (replaces FeatureModel + PlanLimitsModel)
export { PlanFeaturesModel } from './planFeatures.model';
export type { PlanFeature, NewPlanFeature } from './planFeatures.model';

// Coupon models
export { CouponModel } from './coupon.model';
export type { Coupon, NewCoupon } from './coupon.model';
export { CouponUsageModel } from './couponUsage.model';
export type { CouponUsage, NewCouponUsage } from './couponUsage.model';

// Subscription activity timeline (append-only audit log)
export {
  SubscriptionActivityModel,
  SUBSCRIPTION_ACTIVITY_TYPES,
} from './subscriptionActivity.model';
export type {
  SubscriptionActivity,
  NewSubscriptionActivity,
  SubscriptionActivityType,
} from './subscriptionActivity.model';

export {
  BillingMismatchModel,
  billingMismatchKindEnum,
  billingMismatchStatusEnum,
  type BillingMismatch,
} from './billingMismatch.model';

// Note: PlanLimitsModel has been merged into PlanFeaturesModel
