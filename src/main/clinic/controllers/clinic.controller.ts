import { asyncHandler, HttpError } from '../../../middlewear/errorHandler';
import { ClinicService } from '../services/clinic.service';
import { Request, Response } from 'express';
import { sendOk } from '../../../utils/response.utils';
import redisClient from '../../../configurations/redisConfig';

export const createCliniController = asyncHandler(
  async (req: Request, res: Response) => {
    const payload = req.validatedBody;
    const userId = req.user.id;

    const result = await ClinicService.createClinic(userId, payload);
    res.json({ success: true, ...result });
  }
);

export const updateCliniController = asyncHandler(
  async (req: Request, res: Response) => {
    const payload = req.validatedBody;
    const userId = req.user.id;

    const result = await ClinicService.updateClinic(userId, payload);
    res.json({ success: true, ...result });
  }
);

export const updateClinicByIdController = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.params.clinicId as string;
    const payload = req.validatedBody;
    const profileImage = req.file ? (req.file as any).location : undefined;

    // Only Super_Admin may manage another clinic's profile — every other
    // role must only ever be able to touch their own clinic (req.clinicId).
    if (req.user.userType !== 'Super_Admin' && clinicId !== req.clinicId) {
      throw new HttpError(
        403,
        'Access denied. You cannot manage another clinic.'
      );
    }

    const result = await ClinicService.updateClinicById(
      clinicId,
      payload,
      profileImage
    );
    res.json({ success: true, ...result });
  }
);

//! TODO: Hot fix need to reiew and fix.
export const getClinicCliniController = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = req.user.id;
    const result =
      req.user.userType === 'SuperAdmin'
        ? await ClinicService.getClinicDetailsByUserId(userId, req.clinicId)
        : await ClinicService.getClinicByUserId(userId, req.clinicId);

    if (result?.profile) {
      let isFirstLogin = false;

      if (result.profile.userStatus === 'Active') {
        const firstLoginKey = `first_login:user:${userId}`;
        const hasLoggedInBefore = await redisClient.get(firstLoginKey);

        if (!hasLoggedInBefore) {
          isFirstLogin = true;
          await redisClient.set(firstLoginKey, '1');
        }
      }

      result.profile = { ...result.profile, isFirstLogin };
    }

    res.json({
      success: true,
      message: 'Clinic retrieved successfully',
      ...result,
    });
  }
);

export const getCliniController = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.validatedParams.clinicId;

    if (req.user.userType !== 'Super_Admin' && clinicId !== req.clinicId) {
      throw new HttpError(
        403,
        'Access denied. You cannot view another clinic.'
      );
    }

    const result = await ClinicService.getClinicById(clinicId);
    res.json({ success: true, ...result });
  }
);

export const assignClincToUserCrontroller = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.validatedParams.clinicId;
    const userId = req.user.id;
    const result = await ClinicService.assignClinicToUser(clinicId, userId);
    res.json({ success: true, ...result });
  }
);

export const getAvailableClinicsController = asyncHandler(
  async (req: Request, res: Response) => {
    const { page, limit, search, status } = req.validatedQuery;
    const result = await ClinicService.getAvailableClinics({
      page: parseInt(page),
      limit: parseInt(limit),
      search,
      status,
    });
    return sendOk(res, 'Available clinics retrieved successfully', result);
  }
);

export const updateClinicStatusController = asyncHandler(
  async (req: Request, res: Response) => {
    const { clinicId } = req.validatedParams;
    const { status } = req.body;

    const result = await ClinicService.updateClinicStatus(clinicId, status);

    return sendOk(res, 'Clinic status updated successfully', result);
  }
);

export const resetClinicOnboardingController = asyncHandler(
  async (req: Request, res: Response) => {
    const { clinicId } = req.validatedParams;
    const payload = req.validatedBody;

    const result = await ClinicService.resetClinicOnboarding(
      clinicId,
      req.user.id,
      payload
    );

    return sendOk(res, 'Clinic onboarding reset successfully', result);
  }
);

export const deleteClinicController = asyncHandler(
  async (req: Request, res: Response) => {
    const { clinicId } = req.validatedParams;

    const result = await ClinicService.deleteClinic(
      clinicId,
      req.user.id,
      req.validatedBody
    );

    return sendOk(res, 'Clinic deleted successfully', result);
  }
);

export const restoreClinicController = asyncHandler(
  async (req: Request, res: Response) => {
    const { clinicId } = req.validatedParams;

    const result = await ClinicService.restoreClinic(
      clinicId,
      req.user.id,
      req.validatedBody
    );

    return sendOk(res, 'Clinic restored successfully', result);
  }
);

export const getClinicDetailController = asyncHandler(
  async (req: Request, res: Response) => {
    const { clinicId } = req.validatedParams;
    const result = await ClinicService.getClinicDetailById(clinicId);
    return sendOk(res, 'Clinic details retrieved successfully', result);
  }
);

const ONLINE_BOOKING_SETTINGS_KEYS = [
  'onlineBookingEnabled',
  'payOnlineEnabled',
  'payAtClinicEnabled',
  'showClinicNumberPublicly',
] as const;

export const upsertClinicSettingsController = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;
    const payload = req.validatedBody;

    const touchesOnlineBookingSettings = ONLINE_BOOKING_SETTINGS_KEYS.some(
      (key) => payload?.settings?.[key] !== undefined
    );
    if (touchesOnlineBookingSettings && req.user?.userType !== 'Admin') {
      throw new HttpError(
        403,
        'Only the clinic admin can change online booking settings.'
      );
    }

    const result = await ClinicService.clinicSettingUpsert(clinicId, payload);

    // Invalidate cached threshold so the engine picks up the new value immediately
    await redisClient
      .del(`appointment_engine:threshold:${clinicId}`)
      .catch(() => {});

    res.json({
      success: true,
      result,
    });
  }
);

export const getClinicSettingsController = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;
    if (!clinicId) {
      return res
        .status(400)
        .json({ success: false, message: 'Clinic ID not found' });
    }
    const result = await ClinicService.getSetting(clinicId);
    res.json({
      success: true,
      result,
    });
  }
);

export const getDoctorOnlineBookingController = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId as string;
    const { doctorId } = req.validatedParams;

    const result = await ClinicService.getDoctorOnlineBooking(
      clinicId,
      doctorId
    );

    sendOk(res, 'Online booking setting fetched', result);
  }
);

export const setDoctorOnlineBookingController = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId as string;
    const { doctorId } = req.validatedParams;
    const { enabled, maxAdvanceBookingDays } = req.validatedBody;

    const result = await ClinicService.setDoctorOnlineBooking(
      { id: req.user.id, userType: req.user.userType },
      clinicId,
      doctorId,
      { enabled, maxAdvanceBookingDays }
    );

    sendOk(res, 'Online booking setting updated', result);
  }
);

export const getDoctorConsultationDurationController = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId as string;
    const { doctorId } = req.validatedParams;

    const result = await ClinicService.getDoctorConsultationDuration(
      clinicId,
      doctorId
    );

    sendOk(res, 'Consultation length retrieved', result);
  }
);

export const setDoctorConsultationDurationController = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId as string;
    const { doctorId } = req.validatedParams;
    const { defaultConsultationMinutes } = req.validatedBody;

    const result = await ClinicService.setDoctorConsultationDuration(
      { id: req.user.id, userType: req.user.userType },
      clinicId,
      doctorId,
      defaultConsultationMinutes
    );

    sendOk(res, 'Consultation length updated', result);
  }
);

export const deleteClinicReminderController = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;
    const reminderId = req.params.reminderId as string;

    if (!clinicId) throw new Error('Clinic ID not found');
    if (!reminderId) throw new Error('Reminder ID not provided');

    const result = await ClinicService.deleteReminder(clinicId, reminderId);

    res.json({
      success: true,
      result,
    });
  }
);

export const getClinicsWithDoctorsController = asyncHandler(
  async (req: Request, res: Response) => {
    const { startDate, endDate } = req.validatedQuery;

    const result = await ClinicService.getClinicsWithDoctors({
      startDate,
      endDate,
    });

    // Compute request status statistics
    const totalRequests = result.length;
    const pending = result.filter(
      (item) => item.userStatus === 'Pending'
    ).length;
    const approved = result.filter(
      (item) => item.userStatus === 'Active'
    ).length;
    const rejected = result.filter(
      (item) => item.userStatus === 'Rejected'
    ).length;
    const stats = {
      totalRequests,
      pending,
      approved,
      rejected,
    };

    res.json({
      success: true,
      data: result,
      stats,
      filters: {
        startDate: startDate || null,
        endDate: endDate || null,
      },
      total: result.length,
    });
  }
);

export const onboardClinicRouteController = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;
    if (!clinicId) {
      throw new HttpError(400, 'Clinic context required');
    }
    const payload = req.body;
    const clientIp =
      req.ip || (req.headers['x-forwarded-for'] as string) || '127.0.0.1';

    const result = await ClinicService.onboardRouteAccount(
      clinicId,
      payload,
      clientIp
    );
    return sendOk(res, 'Clinic Razorpay Route onboarding initiated', result);
  }
);

export const activateClinicRouteController = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;
    if (!clinicId) {
      throw new HttpError(400, 'Clinic context required');
    }
    const clientIp =
      req.ip || (req.headers['x-forwarded-for'] as string) || '127.0.0.1';

    const result = await ClinicService.activateRouteAccount(clinicId, clientIp);
    return sendOk(res, 'Clinic Razorpay Route activation initiated', result);
  }
);

export const onboardDocumentsController = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;
    if (!clinicId) {
      throw new HttpError(400, 'Clinic context required');
    }

    const file = req.file;
    const { documentType } = req.body;

    if (!file) {
      throw new HttpError(400, 'KYC document file is required');
    }
    if (!documentType) {
      throw new HttpError(400, 'documentType is required');
    }

    const result = await ClinicService.uploadKYCDocuments(
      clinicId,
      documentType,
      file.buffer,
      file.originalname,
      file.mimetype
    );

    return sendOk(res, 'Document uploaded to Razorpay successfully', result);
  }
);

export const updateClinicBankDetailsController = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;
    if (!clinicId) {
      throw new HttpError(400, 'Clinic context required');
    }

    const bankDetails = req.body;
    const clientIp =
      req.ip || (req.headers['x-forwarded-for'] as string) || '127.0.0.1';

    const result = await ClinicService.updateSettlementBank(
      clinicId,
      bankDetails,
      clientIp
    );
    return sendOk(
      res,
      'Settlement bank details update request submitted',
      result
    );
  }
);

export const getClinicOnboardingStatusController = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;
    if (!clinicId) {
      throw new HttpError(400, 'Clinic context required');
    }

    const result = await ClinicService.getOnboardingStatus(clinicId);
    return sendOk(res, 'Onboarding status retrieved successfully', result);
  }
);

export const getClinicBankDetailsController = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;
    if (!clinicId) {
      throw new HttpError(400, 'Clinic context required');
    }
    const result = await ClinicService.getActiveBankDetails(clinicId);
    return sendOk(res, 'Active bank details retrieved successfully', result);
  }
);

export const requestClinicPhoneUpdateController = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;
    if (!clinicId) {
      throw new HttpError(400, 'Clinic context required');
    }
    const { phone } = req.validatedBody;
    const result = await ClinicService.requestClinicPhoneUpdate(
      clinicId,
      phone
    );
    return sendOk(res, result.message, result);
  }
);

export const verifyClinicPhoneController = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;
    if (!clinicId) {
      throw new HttpError(400, 'Clinic context required');
    }
    const { phone, otp } = req.validatedBody;
    const result = await ClinicService.verifyClinicPhone(clinicId, phone, otp);
    return sendOk(res, result.message, result);
  }
);

export const resendClinicPhoneOtpController = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;
    if (!clinicId) {
      throw new HttpError(400, 'Clinic context required');
    }
    const { phone } = req.validatedBody;
    const result = await ClinicService.resendClinicPhoneOtp(clinicId, phone);
    return sendOk(res, result.message, result);
  }
);
