/**
 * Lab events.
 *
 * The lab is the one place where notifying a whole group is right rather than
 * spam: a sample waiting for collection is any assistant's to pick up, so the
 * lab audience is every assistant attached to the clinic. That is unchanged
 * from the current behaviour and deliberately so.
 *
 * Click destinations differ by audience here, which the appointment and payment
 * modules did not need. Lab routes are role-scoped — lab staff reach a test at
 * /lab/assigned, reception at /lab-tests — so a single destination would send
 * half the recipients to a page their role cannot open.
 */

import { PERMISSION_KEYS } from '../../../permissions/utils/permission.constants';
import { defineEvents } from '../defineEvents';
import type { RecipientDeps } from '../types';

export interface LabCtx extends Record<string, unknown> {
  testId: string;
  clinicId: string;
  testName?: string;
  doctorId?: string | null;
  patientId?: string | null;
  performerUserId?: string | null;
  performerName?: string;
  performerRole?: string;
  doctorName?: string;
  clinicName?: string;
}

const except =
  (ctx: LabCtx) =>
  (id: string): boolean =>
    Boolean(id) && id !== ctx.performerUserId;

async function labStaff(
  ctx: LabCtx,
  { directory }: RecipientDeps
): Promise<string[]> {
  const users = await directory.getLabUsers(ctx.clinicId);
  return users.map((u) => u.id).filter(except(ctx));
}

async function clinicDoctors(
  ctx: LabCtx,
  { directory }: RecipientDeps
): Promise<string[]> {
  const users = await directory.getStaffByRole(ctx.clinicId, ['Doctor']);
  return users.map((u) => u.id).filter(except(ctx));
}

const orderingDoctor = (ctx: LabCtx): string[] =>
  ctx.doctorId && ctx.doctorId !== ctx.performerUserId ? [ctx.doctorId] : [];

/**
 * Clinic administrators, for oversight rather than action.
 *
 * Separate from `clinicDoctors` because that resolves to role 'Doctor' and can
 * never return an Admin — the role used to be listed on the doctor audience,
 * which advertised a settings toggle that delivered nothing.
 *
 * An admin who also practises is excluded: they already hear about their own
 * tests through the doctor audience, and a second copy of the same row is the
 * duplicate that exclusion exists to prevent.
 */
async function clinicAdmins(
  ctx: LabCtx,
  { directory }: RecipientDeps
): Promise<string[]> {
  const users = await directory.getStaffByRole(ctx.clinicId, ['Admin']);
  return users
    .map((u) => u.id)
    .filter(except(ctx))
    .filter((id) => id !== ctx.doctorId);
}

const openInLab = (ctx: LabCtx) => ({
  route: '/lab/assigned',
  params: { testId: ctx.testId },
});
const openInReception = (ctx: LabCtx) => ({
  route: '/lab-tests',
  params: { testId: ctx.testId },
});

const clinicTenant = (ctx: LabCtx) => ({
  type: 'clinic' as const,
  id: ctx.clinicId,
});

export const labEvents = defineEvents({
  'lab.test_logged': {
    aliases: ['test_log_created'],
    label: 'Test Log Created',
    description: 'When a lab test is added for a patient.',
    category: 'lab',
    priority: 'normal',
    kind: 'notification',
    configurable: true,
    defaults: { inApp: true, push: true },
    // Oversight, not action: opt-in, and never on their phone. An admin who
    // wants a clinic-wide view of lab activity turns this on; it does not
    // arrive uninvited.
    roleDefaults: { Admin: { inApp: false, push: false } },
    channels: ['inApp', 'push'],
    tenant: clinicTenant,
    collapseKey: (ctx: LabCtx) => `lab-test:${ctx.testId}`,
    clickAction: openInLab,
    audiences: [
      {
        key: 'lab',
        roles: ['Lab_Assistant'],
        requiredPermission: PERMISSION_KEYS.LAB_TEST_VIEW,
        recipients: labStaff,
        message: {
          inApp: (ctx: LabCtx) => ({
            title: `New test – ${ctx.testName || 'lab test'}`,
            body: ctx.doctorName
              ? `Ordered by ${ctx.doctorName}. Added to your queue.`
              : 'Added to your queue.',
          }),
        },
      },
      {
        key: 'doctors',
        // Doctor only. 'Admin' was listed here but clinicDoctors resolves to
        // getStaffByRole(['Doctor']), so no Admin was ever a recipient — the
        // role served only to advertise a toggle on the settings screen that
        // could never deliver anything. The copy ("one of your patients") is
        // written for the treating doctor too.
        roles: ['Doctor'],
        recipients: clinicDoctors,
        clickAction: openInReception,
        message: {
          inApp: (ctx: LabCtx) => ({
            title: `New test – ${ctx.testName || 'lab test'}`,
            body: 'A test was added for one of your patients.',
          }),
        },
      },
      {
        key: 'admins',
        // Clinic-wide oversight. Distinct copy from the doctor audience: an
        // administrator is not reviewing a result for "one of your patients",
        // they are watching what the clinic is doing.
        roles: ['Admin'],
        recipients: clinicAdmins,
        clickAction: openInReception,
        message: {
          inApp: (ctx: LabCtx) => ({
            title: `New test – ${ctx.testName || 'lab test'}`,
            body: ctx.doctorName
              ? `Ordered by ${ctx.doctorName}.`
              : 'A test was added in your clinic.',
          }),
        },
      },
    ],
  },

  'lab.test_assigned': {
    aliases: ['test_assigned_to_lab'],
    label: 'Test Assigned to Lab',
    description: 'When a new lab test is assigned.',
    category: 'lab',
    priority: 'action_required',
    kind: 'notification',
    configurable: true,
    defaults: { inApp: true, push: true },
    // The ordering doctor already knows — they ordered it.
    roleDefaults: { Doctor: { push: false } },
    channels: ['inApp', 'push'],
    tenant: clinicTenant,
    collapseKey: (ctx: LabCtx) => `lab-test:${ctx.testId}`,
    clickAction: openInLab,
    audiences: [
      {
        key: 'lab',
        roles: ['Lab_Assistant', 'Doctor'],
        requiredPermission: PERMISSION_KEYS.LAB_TEST_VIEW,
        recipients: labStaff,
        message: {
          inApp: (ctx: LabCtx) => ({
            title: 'New test for your lab',
            body: ctx.doctorName
              ? `Assigned by Dr. ${ctx.doctorName}. Collect the sample and upload the report.`
              : 'Collect the sample and upload the report.',
          }),
        },
      },
    ],
  },

  'lab.report_uploaded': {
    aliases: ['test_report_uploaded'],
    label: 'Test Report Uploaded',
    description: 'When a report PDF is uploaded.',
    category: 'lab',
    priority: 'action_required',
    kind: 'notification',
    configurable: true,
    defaults: { inApp: true, push: true },
    // Admin: oversight only, so opt-in and never pushed (see the admins
    // audience below on why an 'action_required' event is off for them).
    roleDefaults: {
      Admin: { inApp: false, push: false },
      Lab_Assistant: { push: false },
    },
    channels: ['inApp', 'push'],
    tenant: clinicTenant,
    collapseKey: (ctx: LabCtx) => `lab-report:${ctx.testId}`,
    clickAction: openInLab,
    audiences: [
      {
        key: 'doctor',
        // The doctor who ordered it, not every doctor in the clinic: a result
        // is only actionable by the person who asked the question. 'Admin' was
        // listed here but orderingDoctor returns [ctx.doctorId], so an Admin
        // only ever received this by also being the ordering doctor — the role
        // added a settings toggle that delivered nothing.
        roles: ['Doctor'],
        recipients: orderingDoctor,
        clickAction: openInReception,
        message: {
          inApp: () => ({
            title: 'Test report uploaded',
            body: 'A result is ready for you to review.',
          }),
        },
      },
      {
        key: 'lab',
        // Lab staff are told too: an upload by a doctor or admin is how the
        // lab learns a result landed outside their own workflow.
        roles: ['Lab_Assistant'],
        requiredPermission: PERMISSION_KEYS.LAB_TEST_VIEW,
        recipients: labStaff,
        message: {
          inApp: () => ({
            title: 'Test report uploaded',
            body: 'A report was uploaded for one of your tests.',
          }),
        },
      },
      {
        key: 'admins',
        // Oversight, not review: the ordering doctor is the one who acts on a
        // result. Note this event is priority 'action_required' for everyone,
        // which is right for the doctor but overstates it for an admin — the
        // reason their default is off, so it is opt-in rather than a new item
        // pinned to the top of their Action Required tab.
        roles: ['Admin'],
        recipients: clinicAdmins,
        clickAction: openInReception,
        message: {
          inApp: (ctx: LabCtx) => ({
            title: 'Test report uploaded',
            body: ctx.doctorName
              ? `A result came back for ${ctx.doctorName}'s patient.`
              : 'A result came back in your clinic.',
          }),
        },
      },
      {
        key: 'patient',
        roles: ['Patient'],
        recipients: (ctx: LabCtx) => (ctx.patientId ? [ctx.patientId] : []),
        clickAction: () => ({ route: '/reports' }),
        message: {
          inApp: (ctx: LabCtx) => ({
            title: ctx.testName
              ? `${ctx.testName} report ready`
              : 'Test report ready',
            body: `Your ${ctx.testName ? `${ctx.testName} ` : ''}report from ${
              ctx.clinicName || 'the clinic'
            } is ready. Tap to view or download.`,
          }),
        },
      },
    ],
  },
});
