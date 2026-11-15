// Billing routes are for Admin and Super Admin only; the plan list and plan-gating reads stay open to all staff.
import type { NextFunction, Request, Response, Router } from 'express';
import {
  requireAuth,
  requireClinic,
  requireSuperAdmin,
} from '../../../middlewear/auth.middleware';
import { requireBillingAdmin } from '../middlewares/billingAdmin.middleware';
import addonRouter from '../routes/v1/addons.routes';
import couponsRouter from '../routes/v1/coupons.routes';
import limitationsRouter from '../routes/v1/limitations.route';
import combinedPurchaseRouter from '../routes/v1/subscription.combinedPurchase.routes';
import subscriptionRouter from '../routes/v1/subscription.routes';
import subscriptionRouterV2 from '../routes/v2/subscription.route';
import addOnAdminRouter from '../routes/v2/addOnAdmin.route';
import autoPayRouter from '../routes/v2/autoPay.route';
import billingChecksRouter from '../routes/v2/billingChecks.route';
import creditsRouterV2 from '../routes/v2/credits.route';
import planVersionsRouter from '../routes/v2/planVersions.route';

type Layer = {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: { handle: unknown }[];
  };
};

const routesOf = (router: Router) =>
  new Map(
    (router.stack as unknown as Layer[])
      .filter((layer) => layer.route)
      .map((layer) => [
        `${Object.keys(layer.route!.methods)[0].toUpperCase()} ${layer.route!.path}`,
        layer.route!.stack.map((s) => s.handle),
      ])
  );

const billing: [Router, string[]][] = [
  [
    subscriptionRouter,
    [
      'POST /subscribe',
      'POST /verify-subscription',
      'POST /report-payment-failed',
      'PUT /schedule-cancel',
      'PUT /undo-cancel',
      'POST /check-downgrade',
      'PUT /schedule-downgrade',
      'PUT /undo-downgrade',
      'POST /payment/retry',
      'GET /billing-history',
      'GET /invoice/:invoiceId/download',
      'GET /activity',
    ],
  ],
  [
    addonRouter,
    [
      'GET /available',
      'POST /purchase',
      'POST /quote',
      'POST /verify-purchase',
      'PUT /reduce-quantity/:clinicAddOnId',
      'PUT /schedule-cancel/:clinicAddOnId',
      'PUT /undo-cancel/:clinicAddOnId',
    ],
  ],
  [couponsRouter, ['POST /validate']],
  [combinedPurchaseRouter, ['POST /quote']],
  [subscriptionRouterV2, ['POST /trial']],
];

// The header and feature gates read these for every staff role.
const open: [Router, string[]][] = [
  [subscriptionRouter, ['GET /plans', 'GET /my-subscription']],
  [limitationsRouter, ['GET /overview']],
];

const cases = (list: [Router, string[]][]) =>
  list.flatMap(([router, names]) => {
    const routes = routesOf(router);
    return names.map((name) => [name, routes.get(name)] as const);
  });

describe('billing routes', () => {
  it.each(cases(billing))(
    '%s needs a login, then the billing role, then the clinic',
    (_name, handles) => {
      expect(handles).toBeDefined();
      const auth = handles!.indexOf(requireAuth);
      const role = handles!.indexOf(requireBillingAdmin);
      expect(auth).toBe(0);
      expect(role).toBe(1);
      expect(handles!.indexOf(requireClinic)).toBe(2);
    }
  );
});

describe('open reads', () => {
  it.each(cases(open))('%s has no billing role check', (_name, handles) => {
    expect(handles).toBeDefined();
    expect(handles).not.toContain(requireBillingAdmin);
  });
});

// These files guard every route at once with router.use(...), so the guards sit before the routes.
const guardsOf = (router: Router) => {
  const layers = router.stack as unknown as {
    route?: unknown;
    handle: unknown;
  }[];
  const firstRoute = layers.findIndex((l) => l.route);
  return layers.slice(0, firstRoute).map((l) => l.handle);
};
const hasRoutes = (router: Router) =>
  (router.stack as unknown as { route?: unknown }[]).some((l) => l.route);

describe('clinic billing routers (router-wide guards)', () => {
  it.each([
    ['auto-pay', autoPayRouter],
    ['credits (WhatsApp packs)', creditsRouterV2],
  ] as const)(
    '%s needs a login, then the billing role, then the clinic',
    (_name, router) => {
      expect(hasRoutes(router)).toBe(true);
      expect(guardsOf(router)).toEqual([
        requireAuth,
        requireBillingAdmin,
        requireClinic,
      ]);
    }
  );
});

describe('Super Admin billing routers (router-wide guards)', () => {
  it.each([
    ['billing-checks', billingChecksRouter],
    ['add-on-admin', addOnAdminRouter],
    ['plan-versions', planVersionsRouter],
  ] as const)(
    '%s needs a login, then the Super Admin role',
    (_name, router) => {
      expect(hasRoutes(router)).toBe(true);
      expect(guardsOf(router)).toEqual([requireAuth, requireSuperAdmin]);
    }
  );
});

describe('requireBillingAdmin', () => {
  const run = (userType: string) =>
    new Promise<unknown>((resolve) => {
      const req = { user: { userType } } as unknown as Request;
      requireBillingAdmin(
        req,
        {} as Response,
        ((err?: unknown) => resolve(err)) as NextFunction
      );
    });

  it.each(['Receptionist', 'Doctor', 'Nurse', 'Pharmacist', 'Patient'])(
    'refuses %s with 403',
    async (userType) => {
      expect(await run(userType)).toMatchObject({ status: 403 });
    }
  );

  it.each(['Admin', 'Super_Admin'])('lets %s through', async (userType) => {
    expect(await run(userType)).toBeUndefined();
  });
});
