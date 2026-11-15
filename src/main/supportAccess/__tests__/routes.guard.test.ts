// Every support-access route is guarded: Super Admin routes by requireSuperAdmin, the exit by requireSupportSession.
import type { Router } from 'express';
import {
  requireAuth,
  requireSuperAdmin,
} from '../../../middlewear/auth.middleware';
import { requireSupportSession } from '../middlewares/supportSession.middleware';
import superadminSupportAccessRouter from '../routes/v1/superadmin.route';
import supportAccessRouter from '../routes/v1/supportAccess.route';

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

const guardedBy = (router: Router, guard: unknown) =>
  it.each(routesOf(router).map((r) => [r.name, r.handles] as const))(
    '%s needs a login, then its guard',
    (_name, handles) => {
      expect(handles.indexOf(requireAuth)).toBe(0);
      expect(handles.indexOf(guard)).toBe(1);
    }
  );

describe('Super Admin support-access routes', () => {
  it('has all three routes', () => {
    expect(routesOf(superadminSupportAccessRouter)).toHaveLength(3);
  });
  guardedBy(superadminSupportAccessRouter, requireSuperAdmin);
});

describe('support view routes', () => {
  guardedBy(supportAccessRouter, requireSupportSession);
});
