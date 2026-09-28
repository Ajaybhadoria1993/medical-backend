/**
 * Behavioural invariants of the dispatcher.
 *
 * Everything here is a rule that fails *silently* if broken: nobody sees an
 * error, someone just stops getting told — or starts getting told things they
 * should not. That is exactly the class of bug a typecheck cannot catch, which
 * is why these are worth the mocking.
 */

const insertedRows: Record<string, unknown>[] = [];
const emitted: { room: string; payload: Record<string, unknown> }[] = [];
const pushed: string[] = [];

jest.mock('../../../configurations/dbConnection', () => ({
  database: {
    insert: () => ({
      values: (rows: Record<string, unknown>[]) => {
        insertedRows.push(...rows);
        return {
          onConflictDoUpdate: () => ({
            returning: async () =>
              rows.map((r, i) => ({ id: `row-${i}`, userId: r.userId })),
          }),
        };
      },
    }),
  },
}));

jest.mock('../services/sns.service', () => ({
  SnsNotificationService: {
    sendPushNotification: jest.fn(async (userId: string) => {
      pushed.push(userId);
    }),
  },
}));

const preferences = new Map<string, { inApp: boolean; push: boolean }>();
jest.mock('../preferences/notificationPreferences.utils', () => ({
  getUserNotificationPreferences: jest.fn(
    async (userIds: string[]) =>
      new Map(
        userIds.map((id) => [
          id,
          preferences.get(id) ?? { inApp: true, push: true },
        ])
      )
  ),
}));

const directory = {
  getUser: jest.fn(),
  getStaffResponsibleForDoctor: jest.fn(async () => [
    { id: 'staff-1', name: 'Reception One', userType: 'Receptionist' },
    { id: 'staff-2', name: 'Reception Two', userType: 'Receptionist' },
  ]),
  getStaffByRole: jest.fn(async () => [
    { id: 'staff-1', name: 'Reception One', userType: 'Receptionist' },
    { id: 'staff-2', name: 'Reception Two', userType: 'Receptionist' },
  ]),
  filterByPermission: jest.fn(async (ids: string[]) => ids),
  getLabUsers: jest.fn(async () => []),
  getSuperAdmins: jest.fn(async () => []),
  getUserMobiles: jest.fn(async () => new Map()),
  getClinicChannelSettings: jest.fn(async () => ({
    smsEnabled: false,
    whatsappEnabled: false,
  })),
  getAppointmentContext: jest.fn(async () => ({
    patientName: 'Sunil',
    doctorName: 'Anita Mehta',
    patientMobile: null,
    clinicName: 'Sunrise Clinic',
    appointmentDate: '2026-09-12',
    appointmentTime: '16:30',
    tokenNo: null,
  })),
};

jest.mock('../ports', () => ({
  getDirectoryPort: () => directory,
  getEmitPort: () => ({
    emitToRoom: (
      room: string,
      _event: string,
      payload: Record<string, unknown>
    ) => emitted.push({ room, payload }),
  }),
}));

jest.mock('../killswitch/killSwitch', () => ({
  isLegacyInAppAllowed: () => true,
}));

import { dispatch } from '../services/dispatch.service';

const appointmentCtx = {
  appointmentId: 'a1',
  clinicId: 'c1',
  doctorId: 'doc-1',
  patientId: 'pat-1',
  performerUserId: 'staff-1',
};

beforeEach(() => {
  insertedRows.length = 0;
  emitted.length = 0;
  pushed.length = 0;
  preferences.clear();
  jest.clearAllMocks();
});

describe('recipients', () => {
  it('never notifies the person who performed the action', async () => {
    // staff-1 is the performer here; being told about your own click is the
    // spam this rebuild exists to remove.
    await dispatch({ eventKey: 'appointment.created', ctx: appointmentCtx });
    expect(insertedRows.map((r) => r.userId)).not.toContain('staff-1');
  });

  it('tells someone in only one audience, even when they match two', async () => {
    directory.getStaffResponsibleForDoctor.mockResolvedValueOnce([
      { id: 'pat-1', name: 'Doubled', userType: 'Receptionist' },
    ]);
    await dispatch({ eventKey: 'appointment.created', ctx: appointmentCtx });
    const forUser = insertedRows.filter((r) => r.userId === 'pat-1');
    expect(forUser).toHaveLength(1);
  });

  it('drops recipients who lack the required permission', async () => {
    directory.filterByPermission.mockResolvedValueOnce([]);
    await dispatch({ eventKey: 'appointment.created', ctx: appointmentCtx });
    // The patient audience has no permission rule, so it survives; staff-2
    // (a receptionist with no grant) does not. doc-1 is covered separately
    // below — the treating doctor is exempt from this check.
    const ids = insertedRows.map((r) => r.userId);
    expect(ids).not.toContain('staff-2');
    expect(ids).toContain('pat-1');
  });

  it('never drops the treating doctor for lacking the permission grant', async () => {
    // Mirrors the route-level exemption — requirePermission(APPOINTMENT_VIEW,
    // ['Receptionist']) lets a Doctor through unchecked, so the notification
    // path must not silently un-notify a doctor about their own appointment
    // just because nobody granted them appointment:view.
    directory.filterByPermission.mockResolvedValueOnce([]);
    await dispatch({ eventKey: 'appointment.created', ctx: appointmentCtx });
    expect(insertedRows.map((r) => r.userId)).toContain('doc-1');
  });
});

describe('preferences', () => {
  it('honours a muted in-app preference', async () => {
    preferences.set('doc-1', { inApp: false, push: false });
    await dispatch({ eventKey: 'appointment.created', ctx: appointmentCtx });
    expect(insertedRows.map((r) => r.userId)).not.toContain('doc-1');
  });

  it('records activity even when the user has muted it', async () => {
    // History must survive a mute, or the audit trail has holes in it.
    preferences.set('admin-1', { inApp: false, push: false });
    directory.getStaffByRole.mockResolvedValueOnce([
      { id: 'admin-1', name: 'Admin', userType: 'Admin' },
    ]);
    await dispatch({
      eventKey: 'staff.discount_applied',
      ctx: { clinicId: 'c1', performerUserId: 'other', detail: 'x' },
    });
    expect(insertedRows.map((r) => r.userId)).toContain('admin-1');
  });
});

describe('delivery', () => {
  it('writes a row before emitting, and emits one frame per row', async () => {
    // A socket frame with no row behind it is a toast that can never be marked
    // read.
    await dispatch({ eventKey: 'appointment.created', ctx: appointmentCtx });
    expect(insertedRows.length).toBeGreaterThan(0);
    expect(emitted).toHaveLength(insertedRows.length);
    for (const frame of emitted) {
      expect(frame.payload.notificationId).toBeTruthy();
    }
  });

  it('never pushes for an activity event', async () => {
    directory.getStaffByRole.mockResolvedValueOnce([
      { id: 'admin-1', name: 'Admin', userType: 'Admin' },
    ]);
    await dispatch({
      eventKey: 'staff.discount_applied',
      ctx: { clinicId: 'c1', performerUserId: 'other', detail: 'x' },
    });
    expect(pushed).toHaveLength(0);
  });

  it('does not push to someone who muted push but kept in-app', async () => {
    preferences.set('doc-1', { inApp: true, push: false });
    await dispatch({ eventKey: 'appointment.created', ctx: appointmentCtx });
    expect(insertedRows.map((r) => r.userId)).toContain('doc-1');
    expect(pushed).not.toContain('doc-1');
  });

  it('stamps the event key, category, priority and kind on every row', async () => {
    // The Notification Center filters on these; a null one is an invisible row.
    await dispatch({ eventKey: 'appointment.created', ctx: appointmentCtx });
    for (const row of insertedRows) {
      expect(row.eventKey).toBe('appointment.created');
      expect(row.category).toBe('appointments');
      expect(row.priority).toBeTruthy();
      expect(row.kind).toBe('notification');
      expect(row.clickRoute).toBeTruthy();
    }
  });

  it('renders the schedule into the copy rather than the fallback', async () => {
    await dispatch({ eventKey: 'appointment.created', ctx: appointmentCtx });
    const body = String(insertedRows[0]?.body ?? '');
    expect(body).toContain('12 Sept');
    expect(body.toLowerCase()).not.toContain('no time set');
  });
});

describe('unknown events', () => {
  it('fails permanently rather than retrying forever', async () => {
    // The registry is code, not state: retrying cannot make the key appear.
    await expect(
      dispatch({ eventKey: 'nope.not_a_real_event', ctx: {} })
    ).rejects.toThrow();
    expect(insertedRows).toHaveLength(0);
  });
});
