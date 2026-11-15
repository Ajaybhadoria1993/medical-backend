// Every treatment plan route is guarded: Super Admin routes by requireSuperAdmin, clinic routes by requireClinic.
import type { Router } from 'express';
import {
  requireAuth,
  requireClinic,
  requireSuperAdmin,
} from '../../../middlewear/auth.middleware';
import settingsRouter from '../routes/v1/settings.route';
import specialtyConfigsRouter from '../routes/v1/specialtyConfigs.route';
import superadminRouter from '../routes/v1/superadmin.route';
import templatesRouter from '../routes/v1/templates.route';
import planRouter from '../routes/v1/treatmentPlan.route';

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

describe('Super Admin treatment plan routes', () => {
  const routes = routesOf(superadminRouter);

  it('finds the routes', () => {
    expect(routes.length).toBeGreaterThan(0);
  });

  it.each(routes.map((r) => [r.name, r.handles] as const))(
    '%s needs a login and the Super Admin role',
    (_name, handles) => {
      expect(handles).toContain(requireAuth);
      expect(handles).toContain(requireSuperAdmin);
      expect(handles.indexOf(requireAuth)).toBeLessThan(
        handles.indexOf(requireSuperAdmin)
      );
      expect(handles).not.toContain(requireClinic);
    }
  );
});

describe('clinic treatment plan routes', () => {
  const routes = [
    settingsRouter,
    templatesRouter,
    specialtyConfigsRouter,
    planRouter,
  ].flatMap(routesOf);

  it('finds the routes', () => {
    expect(routes.length).toBeGreaterThan(0);
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
