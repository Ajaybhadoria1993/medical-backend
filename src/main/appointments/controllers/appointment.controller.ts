import { Request, Response } from 'express';
import { asyncHandler, HttpError } from '../../../middlewear/errorHandler';
import { AppointmentService } from '../services/appointment.service';
import { AppointmentActivityHistoryService } from '../services/appointmentActivityHistory.service';
import { NoShowService } from '../services/noShow.service';
import { AppointmentMultipleServiceService } from '../services/appointmentMultipleService.service';
import { sendCreated, sendOk } from '../../../utils/response.utils';
import {
  ClinicNoShowQueryDto,
  CreatePatientGalleryDto,
} from '../schemas/appointment.schemas';
import { database } from '../../../configurations/dbConnection';
import { eq } from 'drizzle-orm';
import { AppointmentPaymentModel } from '../models/appointment-payment.model';
import { AppointmentModel } from '../models/appointment.model';
import { UserModel } from '../../users/models/user.model';
import { notifyClinicAdminsOfStaffAction } from '../../../utils/notificationHelpers';
import logger from '../../../utils/logger';
import { isOfflinePaymentMode } from '../utils/paymentMode.constants';

export const createAppointmentController = asyncHandler(
  async (req: Request, res: Response) => {
    const payload = req.validatedBody;
    const userId = req.user.id;
    const clinicId = req.clinicId;
    const result = await AppointmentService.createAppointment(
      userId,
      clinicId,
      payload,
      userId // Pass performer user ID
    );
    res.status(201).json({ success: true, result });
  }
);

/**
 * @desc Create a custom / override appointment — a booking made deliberately
 *       outside the doctor's configured availability (after hours, during a
 *       break, on a closed day). Reaching this controller already means the
 *       caller passed the `appointment:custom_slot` permission guard.
 */
export const createCustomAppointmentController = asyncHandler(
  async (req: Request, res: Response) => {
    const { customSlotReason, ...payload } = req.validatedBody;
    const userId = req.user.id;
    const clinicId = req.clinicId;

    const result = await AppointmentService.createAppointment(
      userId,
      clinicId,
      payload,
      userId,
      { customSlot: { reason: customSlotReason ?? null } }
    );

    return sendCreated(res, 'Custom appointment created successfully', result);
  }
);

/**
 * @desc Mark an appointment as No Show
 */
export const markAsNoShowController = asyncHandler(
  async (req: Request, res: Response) => {
    const {
      params: { appointmentId: rawAppointmentId },
      validatedBody: payload,
    } = req;
    const appointmentId = rawAppointmentId as string;

    const performerId = req.user.id;
    const performerRole = req.user.userType.toLowerCase() as
      'doctor' | 'receptionist' | 'system' | 'admin';

    const result = await NoShowService.markAsNoShow(
      appointmentId,
      performerId,
      performerRole,
      payload
    );

    return sendOk(res, 'Appointment marked as No Show successfully', result);
  }
);

/**
 * @desc Set No Show Policy for a clinic
 */
export const setNoShowPolicyController = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;
    const payload = req.validatedBody;

    const result = await NoShowService.setPolicy(clinicId, payload);
    return sendOk(res, 'No Show policy updated successfully', result);
  }
);

/**
 * @desc Get No Show Policy for a clinic
 */
export const getNoShowPolicyController = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;
    const result = await NoShowService.getPolicyView(clinicId);
    return sendOk(res, 'No Show policy retrieved successfully', result);
  }
);

/**
 * @desc Get Patient No Show History
 */
export const getPatientNoShowHistoryController = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;
    const patientId = req.validatedParams.patientId;

    const result = await NoShowService.getPatientNoShowHistory(
      patientId,
      clinicId
    );
    return sendOk(
      res,
      'Patient No Show history retrieved successfully',
      result
    );
  }
);

/**
 * @desc Get Clinic No Show Analytics
 */
export const getClinicNoShowAnalyticsController = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;
    const { startDate, endDate, search } =
      req.validatedQuery as ClinicNoShowQueryDto;

    const result = await NoShowService.getClinicNoShowList(
      clinicId,
      startDate,
      endDate,
      search?.trim() || undefined
    );
    return sendOk(
      res,
      'Clinic No Show analytics retrieved successfully',
      result
    );
  }
);

export const getAppointmentPaymentsController = asyncHandler(
  async (req: Request, res: Response) => {
    const { validatedQuery, clinicId } = req;
    const user = req.user; // Attached by requireAuth middleware
    const result = await AppointmentService.getAppointmentPaymentTransactions(
      validatedQuery,
      user,
      clinicId
    );
    return res.status(200).json({
      success: true,
      data: result.data,
      summary: result.summary,
      metadata: result.metadata,
    });
  }
);

export const getAppointmentHistoryController = asyncHandler(
  async (req: Request, res: Response) => {
    const appointmentId = req.validatedParams.appointmentId;
    const result =
      await AppointmentActivityHistoryService.getHistoryByAppointmentId(
        appointmentId
      );
    return sendOk(res, 'Appointment history retrieved successfully', result);
  }
);

export const updateAppointmentController = asyncHandler(
  async (req: Request, res: Response) => {
    const {
      params: { appointmentId: rawAppointmentId },
      validatedBody: payload,
    } = req;
    const appointmentId = rawAppointmentId as string;

    const staffRoles = [
      'Receptionist',
      'Lab_Assistant',
      'Pharmacist',
      'Nurse',
      'Radiologist',
    ];
    const isStaff = staffRoles.includes(req.user?.userType);

    let existingPayment: any = null;
    if (isStaff) {
      try {
        const [pay] = await database
          .select({
            price: AppointmentPaymentModel.price,
            primaryServicePrice: AppointmentPaymentModel.primaryServicePrice,
            paymentStatus: AppointmentPaymentModel.paymentStatus,
            paymentMode: AppointmentPaymentModel.paymentMode,
            refundedAmount: AppointmentPaymentModel.refundedAmount,
          })
          .from(AppointmentPaymentModel)
          .where(eq(AppointmentPaymentModel.appointmentId, appointmentId))
          .limit(1);
        existingPayment = pay;
      } catch (err) {
        logger.error(
          '[Notification] Failed to query appointment payment before update:',
          err
        );
      }
    }

    const result = await AppointmentService.updateAppointment(
      appointmentId,
      payload,
      req.user.id,
      req.user.userType
    );

    if (isStaff && result) {
      try {
        // Fetch staff performer's name
        const [performer] = await database
          .select({ name: UserModel.name })
          .from(UserModel)
          .where(eq(UserModel.id, req.user.id))
          .limit(1);
        const staffName = performer?.name || 'Staff Member';

        // Fetch patient's name
        const [patient] = await database
          .select({ name: UserModel.name })
          .from(UserModel)
          .innerJoin(
            AppointmentModel,
            eq(AppointmentModel.patientId, UserModel.id)
          )
          .where(eq(AppointmentModel.id, appointmentId))
          .limit(1);
        const patientName = patient?.name || 'Patient';

        // 1. Discount Applied
        const oldPrice = existingPayment?.price || '0';
        const oldPrimaryPrice =
          existingPayment?.primaryServicePrice || oldPrice;
        if (
          payload.price &&
          parseFloat(payload.price) < parseFloat(oldPrimaryPrice)
        ) {
          await notifyClinicAdminsOfStaffAction({
            clinicId: result.clinicId,
            title: 'Discount Applied',
            eventKey: 'staff.discount_applied',
            appointmentId,
            body: `Staff member ${staffName} applied a custom discount to ${patientName}'s appointment. Price reduced from ₹${oldPrimaryPrice} to ₹${payload.price}.`,
            action: 'user_created',
          });
        }

        // 2. Refund Initiated
        const alreadyRefunded =
          existingPayment?.paymentStatus?.toLowerCase() === 'refunded';
        if (payload.paymentStatus === 'Refunded' && !alreadyRefunded) {
          const amt =
            payload.refundedAmount || existingPayment?.refundedAmount || '0';
          await notifyClinicAdminsOfStaffAction({
            clinicId: result.clinicId,
            title: 'Refund Initiated',
            eventKey: 'staff.refund_initiated',
            appointmentId,
            body: `Staff member ${staffName} initiated a refund of ₹${amt} for ${patientName}'s appointment.`,
            action: 'user_created',
          });
        }

        // 3. Offline Payment Confirmed
        const alreadyPaid =
          existingPayment?.paymentStatus?.toLowerCase() === 'paid';
        const isPaid = payload.paymentStatus === 'Paid';
        const isOfflineMode = isOfflinePaymentMode(payload.paymentMode);
        if (isPaid && !alreadyPaid && isOfflineMode) {
          const amt = payload.price || existingPayment?.price || '0';
          await notifyClinicAdminsOfStaffAction({
            clinicId: result.clinicId,
            title: 'Offline Payment Confirmed',
            eventKey: 'staff.offline_payment_confirmed',
            appointmentId,
            body: `Staff member ${staffName} confirmed offline payment of ₹${amt} via ${payload.paymentMode} for ${patientName}'s appointment.`,
            action: 'user_created',
          });
        }
      } catch (err) {
        logger.error(
          '[Notification] Error triggering staff financial action alerts:',
          err
        );
      }
    }

    res.status(201).json({ success: true, result });
  }
);

export const upsertDoctorManualPrescriptionController = asyncHandler(
  async (req: Request, res: Response) => {
    const doctorId = req.user.id;
    const appointmentId = req.params.appointmentId as string;
    const doctorManualPrescription = (req.file as any)?.location || null;

    const template = await AppointmentService.upsertDoctorManualPrescription(
      doctorId,
      appointmentId,
      doctorManualPrescription
    );

    return res.status(200).json({
      success: true,
      message: 'Prescription saved successfully',
      data: template,
    });
  }
);

export const sendManualPrescriptionLinkController = asyncHandler(
  async (req: Request, res: Response) => {
    const doctorId = req.user.id;
    const appointmentId = req.params.appointmentId as string;
    const otp = req.validatedBody.otp as string;

    await AppointmentService.sendManualPrescriptionNotification(
      doctorId,
      appointmentId,
      otp
    );

    return res.status(200).json({
      success: true,
      message: 'Notification sent successfully to your mobile device',
    });
  }
);

export const updateConsentFileController = asyncHandler(
  async (req: Request, res: Response) => {
    const appointmentId = req.params.appointmentId as string;
    const consentFile = (req.file as any)?.location;

    if (!consentFile) {
      throw new HttpError(400, 'Consent file is required');
    }

    const result = await AppointmentService.updateConsentFile(
      appointmentId,
      consentFile,
      req.clinicId
    );

    return res.status(200).json({
      success: true,
      result,
    });
  }
);

export const getAllClinicAppointmentController = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;
    const user = req.user;
    const query = req.validatedQuery;
    const result = await AppointmentService.getAllClinicAppointments(
      clinicId,
      query,
      user
    );
    res.status(201).json({ success: true, result });
  }
);

export const getClinicAppointmentDetailsController = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;
    const user = req.user;
    const query = req.validatedQuery;
    const result = await AppointmentService.getClinicAppointmentDetails(
      clinicId,
      query,
      user
    );
    res.status(200).json({ success: true, result });
  }
);

export const getAllUserAppointmentController = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = req.user.id;
    const query = req.validatedQuery;
    const result = await AppointmentService.getALlUserAppountment(
      userId,
      query
    );
    res.status(201).json({ success: true, result });
  }
);
export const getAppointmentController = asyncHandler(
  async (req: Request, res: Response) => {
    const appointmentId = req.validatedParams.appointmentId;
    const requestingUser = {
      id: req.user.id,
      userType: req.user.userType,
      clinicId: req.clinicId,
    };
    const result = await AppointmentService.getAppointment(
      appointmentId,
      requestingUser
    );
    res.status(200).json({ success: true, result });
  }
);

export const getPatientApppointmentController = asyncHandler(
  async (req: Request, res: Response) => {
    const patientId = req.validatedParams.patientId;
    const result = await AppointmentService.getAppointmentByPatient(patientId);
    res.status(201).json({ success: true, result });
  }
);

export const getLastPatientReportCardController = asyncHandler(
  async (req: Request, res: Response) => {
    const patientId = req.validatedParams.patientId;
    const clinicId = req.clinicId;
    const result = await AppointmentService.getLastPatientReportCard(
      patientId,
      clinicId
    );
    res.status(200).json({ success: true, result });
  }
);

export const getDcotorApppointmentController = asyncHandler(
  async (req: Request, res: Response) => {
    const doctorId = req.validatedParams.doctorId;
    const result = await AppointmentService.getAppointmentByDoctor(doctorId);
    res.status(201).json({ success: true, result });
  }
);

export const getAvailableSlotsForDateController = asyncHandler(
  async (req: Request, res: Response) => {
    const { clinicId, validatedQuery, validatedParams } = req;
    const result = await AppointmentService.getAvailableSlotsForDate(
      clinicId,
      validatedQuery,
      validatedParams
    );

    // Check if result has the structure with slots and shifts
    if (result && typeof result === 'object' && 'slots' in result) {
      const { slots, shifts } = result;

      // Add shifts array to every slot in the array
      const modifiedSlots = slots.map((slot) => ({
        ...slot,
        ...(shifts && shifts.length > 0 && { shifts }),
      }));

      // Return the modified slots array as result
      res.status(200).json({
        // Changed from 201 to 200 as this is a GET request
        success: true,
        result: modifiedSlots,
      });
    } else {
      // If result is already an array or something else, return as is
      res.status(200).json({ success: true, result }); // Changed from 201 to 200
    }
  }
);

export const createPatientGalleryController = asyncHandler(
  async (req: Request, res: Response) => {
    const validatedData = req.validatedBody as CreatePatientGalleryDto;
    const doctorId = req.user.id;

    if (!req.file) {
      throw new HttpError(400, 'Image file is required');
    }

    // (req.file as any).location contains the S3 URL
    const imageUrl = (req.file as any).location;

    const result = await AppointmentService.createGalleryImage(
      doctorId,
      imageUrl,
      validatedData
    );

    res.status(201).json({
      success: true,
      message: 'Image uploaded successfully',
      data: result,
    });
  }
);

export const getPatientGalleryController = asyncHandler(
  async (req: Request, res: Response) => {
    const { patientId, appointmentId, page, limit } = req.query;

    // Use validated data or parse with defaults
    const validatedData = {
      patientId: patientId as string,
      appointmentId: appointmentId as string,
      page: page ? parseInt(page as string) : 1,
      limit: limit ? parseInt(limit as string) : 30,
    };

    if (!validatedData.patientId && !validatedData.appointmentId) {
      throw new HttpError(400, 'Either patientId or appointmentId is required');
    }

    const result = await AppointmentService.getPatientGallery(
      validatedData.patientId,
      validatedData.appointmentId,
      validatedData.page,
      validatedData.limit
    );

    res.json({
      success: true,
      data: result.data,
      pagination: result.pagination,
    });
  }
);

export const deletePatientGalleryController = asyncHandler(
  async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const doctorId = req.user.id;

    const deleted = await AppointmentService.deleteGalleryImage(id, doctorId);

    if (!deleted) {
      throw new HttpError(404, 'Image not found');
    }

    res.json({
      success: true,
      message: 'Image deleted successfully',
      data: deleted,
    });
  }
);

export const deleteAppointmentGalleryController = asyncHandler(
  async (req: Request, res: Response) => {
    const appointmentId = req.params.appointmentId as string;
    const doctorId = req.user.id;

    const deleted = await AppointmentService.deleteGalleryImagesByAppointment(
      appointmentId,
      doctorId
    );

    res.json({
      success: true,
      message: `${deleted.length} image(s) deleted successfully`,
      count: deleted.length,
      data: deleted,
    });
  }
);

export const createDoctorGalleryController = asyncHandler(
  async (req: Request, res: Response) => {
    const doctorId = req.user.id;

    if (!req.file) {
      throw new HttpError(400, 'Image file is required');
    }

    const imageUrl = (req.file as any).location;

    const result = await AppointmentService.createDoctorGalleryImage(
      doctorId,
      imageUrl
    );

    res.status(201).json({
      success: true,
      message: 'Image uploaded successfully',
      data: result,
    });
  }
);

export const getDoctorGalleryController = asyncHandler(
  async (req: Request, res: Response) => {
    const doctorId = req.user.id;
    const { page, limit } = req.query;

    const validatedData = {
      page: page ? parseInt(page as string) : 1,
      limit: limit ? parseInt(limit as string) : 30,
    };

    const result = await AppointmentService.getDoctorGallery(
      doctorId,
      validatedData.page,
      validatedData.limit
    );

    res.json({
      success: true,
      data: result.data,
      pagination: result.pagination,
    });
  }
);

export const getDoctorGalleryBySpecialtyController = asyncHandler(
  async (req: Request, res: Response) => {
    const doctorId = req.user.id;
    const { page, limit } = req.query;

    const validatedData = {
      page: page ? parseInt(page as string) : 1,
      limit: limit ? parseInt(limit as string) : 30,
    };

    const result = await AppointmentService.getDoctorGalleryFromLocal(
      doctorId,
      validatedData.page,
      validatedData.limit
    );

    res.json({
      success: true,
      data: result.data,
      pagination: result.pagination,
    });
  }
);

export const deleteDoctorGalleryController = asyncHandler(
  async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const doctorId = req.user.id;

    const deleted = await AppointmentService.deleteDoctorGalleryImage(
      id,
      doctorId
    );

    if (!deleted) {
      throw new HttpError(404, 'Image not found');
    }

    res.json({
      success: true,
      message: 'Image deleted successfully',
      data: deleted,
    });
  }
);

export const getMedicalCertificateController = asyncHandler(
  async (req: Request, res: Response) => {
    const appointmentId = req.params.appointmentId as string;

    const result = await AppointmentService.getMedicalCertificate(
      appointmentId,
      req.clinicId
    );

    res.json({
      success: true,
      message: 'Medical certificate fetched successfully',
      data: result,
    });
  }
);

export const upsertMedicalCertificateController = asyncHandler(
  async (req: Request, res: Response) => {
    const appointmentId = req.params.appointmentId as string;
    const { medicalCondition, restDays, notes } = req.body;

    const result = await AppointmentService.upsertMedicalCertificate(
      appointmentId,
      req.clinicId,
      medicalCondition,
      restDays,
      notes
    );

    return res.status(200).json({
      success: true,
      message: 'Medical certificate saved successfully',
      data: result,
    });
  }
);

export const addMultipleServicesController = asyncHandler(
  async (req: Request, res: Response) => {
    const appointmentId = req.params.appointmentId as string;
    const payload = req.validatedBody;

    const result = await AppointmentMultipleServiceService.addMultipleServices(
      appointmentId,
      payload
    );

    res.status(201).json({
      success: true,
      message: 'Services added successfully',
      data: result,
    });
  }
);

export const getMultipleServicesController = asyncHandler(
  async (req: Request, res: Response) => {
    const appointmentId = req.params.appointmentId as string;

    const result =
      await AppointmentMultipleServiceService.getMultipleServicesByAppointmentId(
        appointmentId,
        req.clinicId
      );

    res.json({
      success: true,
      message: 'Services fetched successfully',
      data: result,
    });
  }
);

export const getRemainingServicesController = asyncHandler(
  async (req: Request, res: Response) => {
    const { appointmentId } = req.params;
    if (!appointmentId || Array.isArray(appointmentId)) {
      throw new HttpError(400, 'Invalid appointmentId');
    }

    if (!appointmentId || Array.isArray(appointmentId)) {
      throw new HttpError(400, 'Invalid appointmentId');
    }

    const result =
      await AppointmentMultipleServiceService.getRemainingServices(
        appointmentId
      );

    res.json({
      success: true,
      message: 'Services fetched successfully',
      data: result,
    });
  }
);

export const convertAppointmentToFreeController = asyncHandler(
  async (req: Request, res: Response) => {
    const appointmentId = req.params.appointmentId as string;

    const result =
      await AppointmentMultipleServiceService.convertAppointmentToFree(
        appointmentId,
        req.clinicId
      );

    return sendOk(
      res,
      'Appointment converted to free consultation successfully',
      result
    );
  }
);
