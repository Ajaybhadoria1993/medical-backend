// Primary export point for subscription models

// Core models to keep
export {
  SubscriptionPlanModel,
  ClinicSubscriptionModel,
} from './subscription.model';
export type {
  SubscriptionPlan,
  NewSubscriptionPlan,
  ClinicSubscription,
  NewClinicSubscription,
} from './subscription.model';

// Add-on models
export { AddOnModel, ClinicAddOnModel } from './addon.model';
export type { AddOn, ClinicAddOn } from './addon.model';

// Usage tracking
export { ClinicUsageModel } from './clinicUsage.model';

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

// Note: PlanLimitsModel has been merged into PlanFeaturesModel
