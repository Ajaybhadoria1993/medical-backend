// Every patient-commission route is guarded: Super Admin routes by requireSuperAdmin, clinic routes by requireClinic.
import type { Router } from 'express';
import {
  requireAuth,
  requireClinic,
  requireSuperAdmin,
} from '../../../middlewear/auth.middleware';
import patientCommissionRouter from '../routes/v1/patientCommission.route';
import superadminPatientCommissionRouter from '../routes/v1/superadmin.route';

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

describe('Super Admin patient-commission routes', () => {
  const routes = routesOf(superadminPatientCommissionRouter);

  it('has all five routes', () => {
    expect(routes).toHaveLength(5);
  });

  it.each(routes.map((r) => [r.name, r.handles] as const))(
    '%s needs a login and the Super Admin role',
    (_name, handles) => {
      expect(handles).toContain(requireAuth);
      expect(handles).toContain(requireSuperAdmin);
      expect(handles.indexOf(requireAuth)).toBeLessThan(
        handles.indexOf(requireSuperAdmin)
      );
    }
  );
});

describe('clinic patient-commission routes', () => {
  const routes = routesOf(patientCommissionRouter);

  it('has both routes', () => {
    expect(routes).toHaveLength(2);
  });

  it.each(routes.map((r) => [r.name, r.handles] as const))(
    '%s needs a login, a role check and the clinic from the token',
    (_name, handles) => {
      expect(handles).toContain(requireAuth);
      expect(handles).toContain(requireClinic);
      // requireRole([...]) sits between them; it is built per route, so check its position.
      expect(
        handles.indexOf(requireClinic) - handles.indexOf(requireAuth)
      ).toBe(2);
    }
  );
});
