import { database } from '../configurations/dbConnection';
import { UserModel } from '../main/users/models/user.model';
import { ClinicAssignModel } from '../main/clinic/models/clinic.model';
import { sendNotificationToUser } from './notification.utils';
import { notify } from '../main/notifications/queues/notification.queue';
import { eq, and, ne, inArray as drizzleInArray, or } from 'drizzle-orm';
import { UserLabAssignmentsModel } from '../main/lab/models/lab.model';
import { ClinicModel } from '../main/clinic/models/clinic.model';
import { sendAppointmentNotification } from './smsClient';
import { ClinicSettingsModel } from '../main/clinic/models/clinicSettings.model';
import { getAppointmentParticipants } from '../main/notifications/models/appointmentParticipants.model';
import {
  formatAppointmentDate,
  formatTimeOrToken,
} from '../main/notifications/utils/whatsappTemplate.utils';
import logger from './logger';
import { envConfig } from './envConfig';
import { appointmentInstantIST } from './istDateTime';
import { resolvePatientMobile } from '../main/patient/services/patientMobile.service';
/**
 * Medisetu Notification System Helpers
 *
 * Important Rule: The user who performs an action will NOT receive a notification for that action.
 */

export interface NotificationUser {
  id: string;
  name: string;
  userType: string;
}

/**
 * Get users by roles within a clinic, excluding specific user IDs
 */
export async function getUsersByRolesInClinic(
  clinicId: string,
  roles: Array<
    'Admin' | 'Doctor' | 'Receptionist' | 'Lab_Assistant' | 'Pharmacist'
  >,
  excludeUserIds: string[] = []
): Promise<NotificationUser[]> {
  const conditions = [eq(ClinicAssignModel.clinicId, clinicId)];

  // Add role filter using OR conditions
  if (roles.length > 0) {
    const roleConditions = roles.map((role) => eq(UserModel.userType, role));
    if (roleConditions.length === 1) {
      conditions.push(roleConditions[0]);
    } else {
      // Use SQL for multiple roles
      conditions.push(drizzleInArray(UserModel.userType, roles));
    }
  }

  // Exclude specific users
  if (excludeUserIds.length > 0) {
    excludeUserIds.forEach((userId) => {
      conditions.push(ne(UserModel.id, userId));
    });
  }

  const users = await database
    .select({
      id: UserModel.id,
      name: UserModel.name,
      userType: UserModel.userType,
    })
    .from(UserModel)
    .innerJoin(ClinicAssignModel, eq(UserModel.id, ClinicAssignModel.userId))
    .where(and(...conditions));

  return users.map((u) => ({ ...u, name: u.name ?? '' }));
}

/**
 * Get user details by ID
 */
export async function getUserById(
  userId: string
): Promise<NotificationUser | null> {
  const [user] = await database
    .select({
      id: UserModel.id,
      name: UserModel.name,
      userType: UserModel.userType,
    })
    .from(UserModel)
    .where(eq(UserModel.id, userId))
    .limit(1);

  return user ? { ...user, name: user.name ?? '' } : null;
}

export async function getLabUsersByClinicId(
  clinicId: string
): Promise<{ id: string }[]> {
  return await database
    .select({
      id: UserLabAssignmentsModel.userId,
    })
    .from(UserLabAssignmentsModel)
    .where(eq(UserLabAssignmentsModel.clinicId, clinicId));
}

/**
 * Send notifications to multiple users
 */
export async function sendNotificationsToUsers(
  users: NotificationUser[],
  title: string,
  body: string,
  metadata?: Record<string, unknown>
) {
  const promises = users.map((user) => {
    return sendNotificationToUser({
      userId: user.id,
      title,
      body,
      type: 'notification',
      metadata,
    });
  });

  await Promise.allSettled(promises);
}

/**
 * Notify about appointment creation
 * Notified: Other Admin, Doctor, Receptionist (excluding performer)
 */
export async function notifyAppointmentCreated(
  clinicId: string,
  appointmentId: string,
  performerUserId: string,
  patientName: string,
  performerName: string,
  performerRole: string,
  doctorId: string,
  patientId: string
) {
  if (envConfig.NOTIFICATIONS_REGISTRY_ENABLED) {
    await notify('appointment.created', {
      appointmentId,
      clinicId,
      doctorId,
      patientId,
      performerUserId,
      patientName,
      performerName,
      performerRole,
    });
    return;
  }

  const title = `New appointment – ${patientName}`;

  const body = `${performerName} (${performerRole}) booked an appointment for ${patientName}. Open the appointment to see the date and time.`;

  const notifyUserIds = new Set<string>();

  // 🔹 1. Notify all Admin + Receptionist (clinic based)
  const staffUsers = await getUsersByRolesInClinic(
    clinicId,
    ['Admin', 'Receptionist'],
    [] // exclusion baad me
  );

  staffUsers.forEach((u) => notifyUserIds.add(u.id));

  // 🔹 2. Notify ONLY the assigned doctor
  if (doctorId) {
    notifyUserIds.add(doctorId);
  }

  // ❌ 3. Remove performer (self notification)
  notifyUserIds.delete(performerUserId);

  if (notifyUserIds.size > 0) {
    await Promise.all(
      [...notifyUserIds].map((userId) =>
        sendNotificationToUser({
          userId,
          title,
          body,
          type: 'notification',
          metadata: {
            appointmentId,
            action: 'appointment_created',
          },
        })
      )
    );
  }

  // 🔹 4. Notify patient (if they are not the performer)
  if (patientId && patientId !== performerUserId) {
    const clinicName = await getClinicNameById(clinicId);
    const patientTitle = 'Appointment booked';
    const patientBody = `Your appointment at ${clinicName || 'the clinic'} is booked. Open it to see the date and time.`;
    await sendNotificationToUser({
      userId: patientId,
      title: patientTitle,
      body: patientBody,
      type: 'notification',
      metadata: {
        appointmentId,
        action: 'appointment_created',
      },
    }).catch((err) => {
      logger.error('Failed to notify patient about appointment creation', err);
    });
  }
}

/**
 * Notify about appointment reschedule
 * Notified: Doctor (excluding performer)
 */
export async function notifyAppointmentRescheduled(
  appointmentId: string,
  performerUserId: string,
  performerName: string,
  performerRole: string,
  doctorId?: string,
  patientId?: string,
  clinicId?: string,
  newSchedule?: { date: Date; time: string; tokenNo: number | null }
) {
  if (envConfig.NOTIFICATIONS_REGISTRY_ENABLED && clinicId) {
    await notify('appointment.rescheduled', {
      appointmentId,
      clinicId,
      doctorId: doctorId ?? null,
      patientId: patientId ?? null,
      performerUserId,
      performerName,
      performerRole,
    });

    // WhatsApp is NOT the registry's job yet — it still goes out from here.
    // Dropping it when the in-app path moved would have silently stopped
    // patients receiving reschedule messages, and no typecheck or review of
    // notification code would have caught that.
    if (patientId) {
      const clinicName = await getClinicNameById(clinicId);
      await sendRescheduleToPatient(
        appointmentId,
        patientId,
        clinicId,
        clinicName,
        newSchedule
      ).catch((err) => {
        logger.error(
          `Failed to send reschedule WhatsApp for appointment ${appointmentId}: ${(err as Error).message}`
        );
      });
    }
    return;
  }

  // Notify Doctor
  if (doctorId && doctorId !== performerUserId) {
    const title = 'Appointment rescheduled';
    const body = `${performerName} (${performerRole}) rescheduled an appointment. Open it to see the new date and time.`;

    // No user lookup: doctorId is already the recipient. Fetching the row only
    // to read back the same id cost a query per reschedule.
    await sendNotificationToUser({
      userId: doctorId,
      title,
      body,
      type: 'notification',
      metadata: { appointmentId, action: 'appointment_rescheduled' },
    });
  }

  // Notify Patient
  if (patientId && patientId !== performerUserId) {
    const clinicName = clinicId ? await getClinicNameById(clinicId) : undefined;
    const title = 'Appointment rescheduled';
    const body = `Your appointment at ${clinicName || 'the clinic'} was rescheduled by ${performerName}. Open it to see the new date and time.`;
    await sendNotificationToUser({
      userId: patientId,
      title,
      body,
      type: 'notification',
      metadata: { appointmentId, action: 'appointment_rescheduled' },
    }).catch((err) => {
      logger.error('Failed to notify patient about reschedule', err);
    });

    await sendRescheduleToPatient(
      appointmentId,
      patientId,
      clinicId,
      clinicName,
      newSchedule
    ).catch((err) => {
      logger.error(
        `Failed to send reschedule SMS/WhatsApp for appointment ${appointmentId}: ${(err as Error).message}`
      );
    });
  }
}

/**
 * The new date/time is passed in rather than re-read from the appointment row:
 * the caller runs inside the update transaction, so a fresh read here would
 * still return the pre-reschedule schedule.
 */
async function sendRescheduleToPatient(
  appointmentId: string,
  patientId: string,
  clinicId: string | undefined,
  clinicName: string | undefined,
  newSchedule?: { date: Date; time: string; tokenNo: number | null }
) {
  if (!clinicId || !clinicName || !newSchedule) return;

  const [patient, settings] = await Promise.all([
    database
      .select({ mobile: UserModel.mobile })
      .from(UserModel)
      .where(eq(UserModel.id, patientId))
      .then((res) => res[0]),
    database
      .select()
      .from(ClinicSettingsModel)
      .where(eq(ClinicSettingsModel.clinicId, clinicId))
      .then((res) => res[0]),
  ]);

  if (!settings) return;
  const mobile = await resolvePatientMobile(patientId, patient?.mobile);
  if (!mobile) return;
  // WHATSAPP_FORCE_ENABLED must be checked here too: with both clinic flags
  // off this returns before reaching the send, where the override lives.
  if (
    !settings.smsEnabled &&
    !settings.whatsappEnabled &&
    !envConfig.WHATSAPP_FORCE_ENABLED
  )
    return;

  const scheduledAt = appointmentInstantIST(newSchedule.date, newSchedule.time);

  const formattedDate = formatAppointmentDate(scheduledAt);
  const timeOrToken = formatTimeOrToken(scheduledAt, newSchedule.tokenNo);
  const { patientName, doctorName } =
    await getAppointmentParticipants(appointmentId);

  const smsBody = `Appointment Rescheduled:\n\nClinic: ${clinicName}\nDate: ${formattedDate}\n${timeOrToken}\n\nPlease arrive 10 minutes early.`;

  await sendAppointmentNotification(
    mobile,
    smsBody,
    settings.whatsappEnabled ?? false,
    {
      key: 'appointmentRescheduled',
      params: {
        patientName,
        doctorName,
        clinicName,
        date: formattedDate,
        timeOrToken,
      },
    }
  );
}

/**
 * Notify about appointment confirmation
 * Notified: Doctor (excluding performer)
 */
export async function notifyAppointmentConfirmed(
  appointmentId: string,
  performerUserId: string,
  performerName: string,
  performerRole: string,
  doctorId?: string,
  patientId?: string,
  clinicId?: string
) {
  if (envConfig.NOTIFICATIONS_REGISTRY_ENABLED && clinicId) {
    await notify('appointment.confirmed', {
      appointmentId,
      clinicId,
      doctorId: doctorId ?? null,
      patientId: patientId ?? null,
      performerUserId,
      performerName,
      performerRole,
    });
    return;
  }

  // Notify Doctor
  if (doctorId && doctorId !== performerUserId) {
    const title = 'Appointment confirmed';
    const body = `${performerName} (${performerRole}) confirmed an appointment on your schedule.`;

    await sendNotificationToUser({
      userId: doctorId,
      title,
      body,
      type: 'notification',
      metadata: { appointmentId, action: 'appointment_confirmed' },
    });
  }

  // Notify Patient
  if (patientId && patientId !== performerUserId) {
    const clinicName = clinicId ? await getClinicNameById(clinicId) : undefined;
    const title = 'Appointment confirmed';
    const body = `Your appointment at ${clinicName || 'the clinic'} is confirmed. Please arrive 10 minutes early.`;
    await sendNotificationToUser({
      userId: patientId,
      title,
      body,
      type: 'notification',
      metadata: { appointmentId, action: 'appointment_confirmed' },
    }).catch((err) => {
      logger.error('Failed to notify patient about confirmation', err);
    });
  }
}

/**
 * Notify about payment completion
 * Notified: Patient
 */
export async function notifyPaymentReceived(
  appointmentId: string,
  patientId: string,
  amount: string,
  clinicId?: string
) {
  if (envConfig.NOTIFICATIONS_REGISTRY_ENABLED) {
    // The registry adds a staff audience this helper never had — the gap that
    // let a second receptionist collect a payment already taken.
    await notify('payment.received', {
      appointmentId,
      clinicId,
      patientId,
      amount,
      doctorId: null,
      // patientName omitted on purpose: caller values win over enrich, so a
      // blank here would blank the staff title.
    });
    return;
  }

  if (patientId) {
    const clinicName = clinicId ? await getClinicNameById(clinicId) : undefined;
    const title = 'Payment received';
    const body = `Your payment of ₹${amount} for the appointment at ${clinicName || 'the clinic'} was received. No further action is needed.`;
    await sendNotificationToUser({
      userId: patientId,
      title,
      body,
      type: 'notification',
      metadata: { appointmentId, action: 'payment_received' },
    }).catch((err) => {
      logger.error('Failed to notify patient about payment success', err);
    });
  }
}

/**
 * Notify about appointment cancellation
 * Notified: Doctor, Receptionist (excluding performer)
 */
export async function notifyAppointmentCanceled(
  clinicId: string,
  appointmentId: string,
  performerUserId: string,
  performerName: string,
  performerRole: string,
  doctorId?: string,
  patientId?: string
) {
  if (envConfig.NOTIFICATIONS_REGISTRY_ENABLED) {
    await notify('appointment.cancelled', {
      appointmentId,
      clinicId,
      doctorId: doctorId ?? null,
      patientId: patientId ?? null,
      performerUserId,
      performerName,
      performerRole,
    });
    return;
  }

  const title = 'Appointment cancelled';
  const body = `${performerName} (${performerRole}) cancelled an appointment. The slot is now free.`;

  const users: NotificationUser[] = [];

  // Get Receptionists from clinic
  const receptionists = await getUsersByRolesInClinic(
    clinicId,
    ['Receptionist'],
    [performerUserId]
  );
  users.push(...receptionists);

  // Notify the assigned doctor
  if (doctorId && doctorId !== performerUserId) {
    // sendNotificationsToUsers reads only `id`, so the row fetch bought nothing.
    if (!users.some((u) => u.id === doctorId)) {
      users.push({ id: doctorId, name: '', userType: 'Doctor' });
    }
  }

  if (users.length > 0) {
    await sendNotificationsToUsers(users, title, body, {
      appointmentId,
      action: 'appointment_canceled',
    });
  }

  // Notify Patient
  if (patientId && patientId !== performerUserId) {
    const clinicName = await getClinicNameById(clinicId);
    const patientTitle = 'Appointment cancelled';
    const patientBody = `Your appointment at ${clinicName || 'the clinic'} was cancelled by ${performerName}. Book a new appointment if you still need one.`;
    await sendNotificationToUser({
      userId: patientId,
      title: patientTitle,
      body: patientBody,
      type: 'notification',
      metadata: { appointmentId, action: 'appointment_canceled' },
    }).catch((err) => {
      logger.error('Failed to notify patient about cancellation', err);
    });
  }
}

/**
 * Notify about test log creation
 * Notified: Doctor or Lab (excluding performer and admin)
 */
export async function notifyTestLogCreated(
  clinicId: string,
  testId: string,
  name: string,
  performerUserId: string,
  performerRole: string
) {
  if (envConfig.NOTIFICATIONS_REGISTRY_ENABLED) {
    await notify('lab.test_logged', {
      testId,
      clinicId,
      testName: name,
      performerUserId,
      performerRole,
    });
    return;
  }

  // 🔹 clinic name DB se
  const clinicName = await getClinicNameById(clinicId);

  const title = `New test – ${name}`;
  const body = `A ${name} test was added${
    clinicName ? ` at ${clinicName}` : ''
  }. Open it to see the patient and test details.`;

  const notifyUserIds = new Set<string>();

  // ✅ Admin creates test → ALL doctors + ALL lab assistants
  if (performerRole === 'Admin') {
    const [labUsers, doctorUsers] = await Promise.all([
      getLabUsersByClinicId(clinicId),
      getDoctorUsersByClinicId(clinicId),
    ]);

    labUsers.forEach((u) => notifyUserIds.add(u.id));
    doctorUsers.forEach((u) => notifyUserIds.add(u.id));
  }

  // ❌ remove performer (admin)
  notifyUserIds.delete(performerUserId);

  if (!notifyUserIds.size) return;

  await Promise.all(
    [...notifyUserIds].map((userId) =>
      sendNotificationToUser({
        userId,
        title,
        body,
        type: 'notification',
        metadata: {
          testId,
          action: 'test_log_created',
        },
      })
    )
  );
}

export async function getDoctorUsersByClinicId(clinicId: string) {
  return await database
    .select({
      id: ClinicAssignModel.userId,
    })
    .from(ClinicAssignModel)
    .innerJoin(UserModel, eq(UserModel.id, ClinicAssignModel.userId))
    .where(
      and(
        eq(ClinicAssignModel.clinicId, clinicId),
        eq(UserModel.userType, 'Doctor')
      )
    );
}
async function getClinicNameById(
  clinicId: string
): Promise<string | undefined> {
  const [clinic] = await database
    .select({ name: ClinicModel.clinicName })
    .from(ClinicModel)
    .where(eq(ClinicModel.id, clinicId))
    .limit(1);

  return clinic?.name;
}

/**
 * Notify about test assignment to lab
 * Notified: Assigned Lab (excluding performer)
 */
export async function notifyTestAssignedToLab(
  testId: string,
  clinicId: string,
  performerUserId: string,
  performerName: string,
  performerRole: string,
  doctorName?: string
) {
  if (envConfig.NOTIFICATIONS_REGISTRY_ENABLED) {
    await notify('lab.test_assigned', {
      testId,
      clinicId,
      performerUserId,
      performerName,
      performerRole,
      doctorName,
    });
    return;
  }

  const title = 'New test for your lab';
  const body = `A test was assigned to your lab${
    doctorName ? ` by Dr. ${doctorName}` : ''
  }. Open it to collect the sample and upload the report.`;

  const labUsers = await getLabUsersByClinicId(clinicId);

  for (const labUser of labUsers) {
    // 🔒 Do not notify self
    if (labUser.id === performerUserId) {
      continue;
    }

    await sendNotificationToUser({
      userId: labUser.id,
      title,
      body,
      type: 'notification',
      metadata: {
        testId,
        action: 'test_assigned_to_lab',
      },
    });
  }
}

/**
 * Notify about test report upload
 * Notified: All related users except uploader and admin
 */
export async function notifyTestReportUploaded(
  clinicId: string,
  testId: string,
  performerUserId: string,
  performerName: string,
  performerRole: string,
  doctorId?: string,
  patientId?: string,
  testName?: string
) {
  if (envConfig.NOTIFICATIONS_REGISTRY_ENABLED) {
    await notify('lab.report_uploaded', {
      testId,
      clinicId,
      doctorId,
      patientId,
      testName,
      // Patient copy says where the report came from.
      clinicName: await getClinicNameById(clinicId),
      performerUserId,
      performerName,
      performerRole,
    });
    return;
  }

  const title = 'Test report uploaded';
  const body = `${performerName} (${performerRole}) uploaded a test report. Open it to review the results.`;

  const notifyUserIds = new Set<string>();

  // 🔹 Doctor uploaded → notify all lab users
  if (performerRole === 'Doctor') {
    const labUsers = await getLabUsersByClinicId(clinicId);
    labUsers.forEach((u) => notifyUserIds.add(u.id));
  }

  // 🔹 Lab user uploaded → notify doctor
  if (performerRole === 'Lab_Assistant' && doctorId) {
    notifyUserIds.add(doctorId);
  }

  // 🔹 Admin uploaded → notify doctor + lab users
  if (performerRole === 'Admin') {
    if (doctorId) notifyUserIds.add(doctorId);

    const labUsers = await getLabUsersByClinicId(clinicId);
    labUsers.forEach((u) => notifyUserIds.add(u.id));
  }

  // ❌ Remove performer (self notification)
  notifyUserIds.delete(performerUserId);

  if (notifyUserIds.size > 0) {
    // 🔔 Send notifications
    await Promise.all(
      [...notifyUserIds].map((userId) =>
        sendNotificationToUser({
          userId,
          title,
          body,
          type: 'notification',
          metadata: {
            testId,
            action: 'test_report_uploaded',
          },
        })
      )
    );
  }

  // 🔔 Send notification to patient
  if (patientId && patientId !== performerUserId) {
    const patientBody = `Your ${testName ? `${testName} ` : ''}test report is ready. Open it to view or download the report.`;
    await sendNotificationToUser({
      userId: patientId,
      title: 'Test report ready',
      body: patientBody,
      type: 'notification',
      metadata: {
        testId,
        action: 'test_report_uploaded',
      },
    }).catch((err) => {
      logger.error('Failed to notify patient about test report upload', err);
    });
  }
}

/**
 * Notify about new user creation
 * Notified: The new user
 *
 * Has no in-repo caller today, but it is the only trigger for
 * 'account.welcome' — deleting it as an unused export silently removes the
 * one-time welcome every new user receives.
 */
export async function notifyNewUserCreated(
  newUserId: string,
  newUserName: string,
  newUserRole: string
) {
  if (envConfig.NOTIFICATIONS_REGISTRY_ENABLED) {
    await notify('account.welcome', {
      userId: newUserId,
      userName: newUserName,
      userRole: newUserRole,
    });
    return;
  }

  const title = 'Welcome to Medisetu';
  const body = `Your ${newUserRole} account is ready. You can update your profile and notification preferences in Settings.`;

  await sendNotificationToUser({
    userId: newUserId,
    title,
    body,
    type: 'notification',
    metadata: {
      action: 'user_created',
      userType: newUserRole,
    },
  });
}

/**
 * Notify about No Show
 * Notified: Patient (SMS/WhatsApp), Doctor, Receptionist (App Notification)
 */
export async function notifyAppointmentNoShow(
  appointmentId: string,
  clinicId: string,
  patientId: string,
  doctorId: string | null,
  actionTaken: string,
  reason: string
) {
  const [patient, clinic, settings] = await Promise.all([
    database
      .select({ mobile: UserModel.mobile, name: UserModel.name })
      .from(UserModel)
      .where(eq(UserModel.id, patientId))
      .then((res) => res[0]),
    database
      .select({ clinicName: ClinicModel.clinicName })
      .from(ClinicModel)
      .where(eq(ClinicModel.id, clinicId))
      .then((res) => res[0]),
    database
      .select()
      .from(ClinicSettingsModel)
      .where(eq(ClinicSettingsModel.clinicId, clinicId))
      .then((res) => res[0]),
  ]);

  if (!patient || !clinic) return;

  const title = 'Marked as no show';
  const body = `The appointment for ${patient.name || 'the patient'} at ${clinic.clinicName} was marked as a no show (${reason}). What happens next: ${actionTaken}.`;

  // 1. Send SMS/WhatsApp to Patient if enabled
  const patientMobile = await resolvePatientMobile(patientId, patient.mobile);
  if (patientMobile && settings) {
    await sendAppointmentNotification(
      patientMobile,
      body,
      settings.whatsappEnabled ?? false,
      {
        key: 'appointmentNoShow',
        params: {
          patientName: patient.name || 'Patient',
          doctorName: (await getAppointmentParticipants(appointmentId))
            .doctorName,
          clinicName: clinic.clinicName,
          actionTaken,
          reason,
        },
      }
    ).catch((err) => {
      logger.error(
        `Failed to send no-show notification for appointment ${appointmentId}: ${(err as Error).message}`
      );
    });
  }

  // 2. Send App Notifications to Clinic Staff
  //
  // The guard is deliberately below the WhatsApp block rather than at the top
  // of the function: this helper messages the patient *and* fans out to staff,
  // and returning early would have taken the patient's no-show WhatsApp with
  // it. Only the staff fan-out moves to the registry.
  if (envConfig.NOTIFICATIONS_REGISTRY_ENABLED) {
    await notify('appointment.no_show', {
      appointmentId,
      clinicId,
      doctorId,
      patientId,
      actionTaken,
      reason,
    });
    return;
  }

  const notifyUserIds = new Set<string>();

  // Get Admin + Receptionist
  const staffUsers = await getUsersByRolesInClinic(clinicId, [
    'Admin',
    'Receptionist',
  ]);
  staffUsers.forEach((u) => notifyUserIds.add(u.id));

  // Get Doctor
  if (doctorId) {
    notifyUserIds.add(doctorId);
  }

  if (notifyUserIds.size > 0) {
    await Promise.all(
      [...notifyUserIds].map((userId) =>
        sendNotificationToUser({
          userId,
          title,
          body: `${patient.name || 'The patient'} was marked as a no show. What happens next: ${actionTaken}.`,
          type: 'notification',
          metadata: {
            appointmentId,
            action: 'appointment_no_show',
            patientId,
          },
        })
      )
    );
  }
}

// -----------------------------------------------------------------------------
// Prescription PDF notifications
// -----------------------------------------------------------------------------

/**
 * Notify a patient that their prescription PDF generation has started.
 * This is triggered from `ReportService.generatePdfAndSendNotifications`
 * before the heavy PDF work begins so that the UI can display a spinner
 * or similar indicator in real time.
 */
export async function notifyPrescriptionPdfGenerationStarted(
  patientId: string,
  reportId: string,
  appointmentId: string
) {
  const title = 'Preparing your prescription';
  const body = `Your prescription is being prepared. We'll let you know as soon as it's ready to download.`;

  await sendNotificationToUser({
    userId: patientId,
    title,
    body,
    type: 'notification',
    metadata: { reportId, appointmentId, action: 'pdf_generation_started' },
  });
}

/**
 * Notify a patient that their prescription PDF is ready and provide the link
 * to download/view it. This should be called immediately after the
 * `ReportCardModel` record has been updated with the new URL.
 * Clients joined to socket room `appointment:<appointmentId>` also receive
 * `appointment.prescription.pdf_ready` via `broadcastPrescriptionPdfReadyToAppointmentRoom`.
 */
export async function notifyPrescriptionPdfReady(
  patientId: string,
  reportId: string,
  pdfUrl: string,
  appointmentId: string
) {
  if (envConfig.NOTIFICATIONS_REGISTRY_ENABLED) {
    await notify('prescription.ready', {
      appointmentId,
      patientId,
      reportId,
      pdfUrl,
    });
    return;
  }

  const title = 'Prescription ready';
  const body = `Your prescription is ready. Open it to view or download the PDF.`;

  await sendNotificationToUser({
    userId: patientId,
    title,
    body,
    type: 'notification',
    metadata: { reportId, pdfUrl, appointmentId, action: 'pdf_ready' },
  });
}

/**
 * Notify Super Admins when a new clinic is created
 * Notified: All Super_Admin users (excluding performer)
 */
export async function notifyClinicCreated(
  clinicId: string,
  clinicName: string,
  performerUserId: string,
  performerName: string,
  performerRole: string
) {
  // Only queried when needed: the registry resolves its own recipients, and
  // SUPER_ADMIN_NOTIFY_EMAILS replaces the DB list for email.
  const getSuperAdmins = () =>
    database
      .select({
        id: UserModel.id,
        name: UserModel.name,
        userType: UserModel.userType,
        email: UserModel.email,
      })
      .from(UserModel)
      .where(
        and(
          eq(UserModel.userType, 'Super_Admin'),
          ne(UserModel.id, performerUserId)
        )
      );

  const title = 'New clinic registered';
  const body = `${performerName} (${performerRole}) registered the clinic "${clinicName}". Open it to review the clinic details.`;

  // 1. Send in-app and push notifications
  //
  // Only the in-app fan-out moves; the super-admin email below is a separate
  // channel this helper also owns, and dropping it would be invisible from the
  // notification side.
  if (envConfig.NOTIFICATIONS_REGISTRY_ENABLED) {
    await notify('clinic.created', {
      clinicId,
      clinicName,
      performerUserId,
      performerName,
      performerRole,
    });
  } else {
    const superAdmins = await getSuperAdmins();
    await Promise.all(
      superAdmins.map((admin) =>
        sendNotificationToUser({
          userId: admin.id,
          title,
          body,
          type: 'notification',
          metadata: {
            clinicId,
            action: 'clinic_created',
          },
        })
      )
    );
  }

  // 2. Send email notifications asynchronously
  setImmediate(async () => {
    try {
      const { sendEmail } = await import('./email');
      const { clinicCreationNotificationTemplate } =
        await import('../htmltamplates/clinicCreationNotification');
      const [clinic] = await database
        .select()
        .from(ClinicModel)
        .where(eq(ClinicModel.id, clinicId))
        .limit(1);

      if (!clinic) return;

      const emailRecipients = envConfig.SUPER_ADMIN_NOTIFY_EMAILS
        ? envConfig.SUPER_ADMIN_NOTIFY_EMAILS.map((email) => ({
            email,
            name: null,
          }))
        : await getSuperAdmins();

      for (const admin of emailRecipients) {
        if (admin.email) {
          await sendEmail(
            admin.email,
            `New Clinic Registered: ${clinicName}`,
            clinicCreationNotificationTemplate({
              superAdminName: admin.name || 'Super Admin',
              clinicName: clinicName,
              creatorName: performerName,
              creatorRole: performerRole,
              clinicAddress: clinic.clinicAddress || 'N/A',
              clinicPhone: clinic.clinicPhone || 'N/A',
            })
          ).catch((e) => {
            logger.error(
              `[Notification] Failed to send clinic creation email to ${admin.email}:`,
              e
            );
          });
        }
      }
    } catch (err) {
      logger.error(
        'Error in notifyClinicCreated setImmediate email dispatch:',
        err
      );
    }
  });
}

// Notify Super Admins when a doctor submits a profile update request
export async function notifyDoctorProfileUpdateRequested(
  requestId: string,
  doctorId: string,
  doctorName: string,
  clinicId?: string | null,
  clinicName?: string | null
) {
  if (!envConfig.NOTIFICATIONS_REGISTRY_ENABLED) return;

  await notify('doctor.profile_update_requested', {
    requestId,
    doctorId,
    doctorName,
    clinicId,
    clinicName,
  });
}

export async function notifyClinicAdminsOfStaffAction(params: {
  clinicId: string;
  title: string;
  body: string;
  action: string;
  /**
   * Registry event key, e.g. 'staff.discount_applied'.
   *
   * Every caller used to pass `action: 'user_created'` regardless of what
   * happened, which made these indistinguishable from each other and from the
   * genuine welcome notification — muting that one silenced the clinic's whole
   * financial audit trail. This is what separates them.
   */
  eventKey?: string;
  excludeUserId?: string;
  /**
   * The appointment the action was performed on, where there is one. Without
   * it the entry has nothing to open — the body text names an appointment the
   * reader then cannot reach.
   */
  appointmentId?: string | null;
}) {
  const {
    clinicId,
    title,
    body,
    action,
    eventKey,
    excludeUserId,
    appointmentId,
  } = params;

  if (envConfig.NOTIFICATIONS_REGISTRY_ENABLED && eventKey) {
    await notify(eventKey, {
      clinicId,
      performerUserId: excludeUserId ?? null,
      detail: body,
      appointmentId: appointmentId ?? null,
    });
    return;
  }

  try {
    const admins = await database
      .select({
        id: UserModel.id,
      })
      .from(UserModel)
      .innerJoin(ClinicAssignModel, eq(ClinicAssignModel.userId, UserModel.id))
      .where(
        and(
          eq(ClinicAssignModel.clinicId, clinicId),
          or(
            eq(UserModel.userType, 'Admin'),
            eq(UserModel.isAdminDoctorAccess, true)
          )
        )
      );

    for (const admin of admins) {
      if (excludeUserId && admin.id === excludeUserId) continue;

      await sendNotificationToUser({
        userId: admin.id,
        title,
        body,
        type: 'notification',
        metadata: {
          clinicId,
          action,
          source: 'staff-action-alert',
          ...(appointmentId ? { appointmentId } : {}),
        },
      });
    }
  } catch (err) {
    logger.error(
      `[Notification] Failed to notify clinic admins of action ${action}:`,
      err
    );
  }
}
