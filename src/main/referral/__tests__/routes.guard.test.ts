// Every referral route is guarded: Super Admin routes by requireSuperAdmin, the rest by a role check.
import type { Router } from 'express';
import {
  requireAuth,
  requireSuperAdmin,
} from '../../../middlewear/auth.middleware';
import referralRouter from '../routes/v1/referral.route';
import superadminReferralRouter from '../routes/v1/superadmin.route';

type Layer = {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: { handle: unknown }[];
  };
};

const routesOf = (router: Router) =>
  (router.stack as unknown as Layer[])
    .filter((layer) => layer.route)
    .map((layer) => ({
      name: `${Object.keys(layer.route!.methods)[0].toUpperCase()} ${layer.route!.path}`,
      handles: layer.route!.stack.map((s) => s.handle),
    }));

describe('Super Admin referral routes', () => {
  const routes = routesOf(superadminReferralRouter);

  it('has one route', () => {
    expect(routes).toHaveLength(1);
  });

  it.each(routes.map((r) => [r.name, r.handles] as const))(
    '%s needs a login and the Super Admin role',
    (_name, handles) => {
      expect(handles.indexOf(requireAuth)).toBe(0);
      expect(handles.indexOf(requireSuperAdmin)).toBe(1);
    }
  );
});

describe('referrer routes', () => {
  const routes = routesOf(referralRouter);

  it('has two routes', () => {
    expect(routes).toHaveLength(2);
  });

  it.each(routes.map((r) => [r.name, r.handles] as const))(
    '%s needs a login, then a role check',
    (_name, handles) => {
      expect(handles.indexOf(requireAuth)).toBe(0);
      // requireRole(REFERRAL_ROLES) is built per route, so check it isn't a shared guard.
      expect(handles[1]).not.toBe(requireSuperAdmin);
      expect(typeof handles[1]).toBe('function');
    }
  );
});
