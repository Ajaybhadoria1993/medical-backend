import { Request, Response } from 'express';
import { asyncHandler } from '../../../middlewear/errorHandler';
import { AppointmentTestService } from '../services/appointmentTest.service';
import { HttpError } from '../../../middlewear/errorHandler';

type UploadedLocationFile = Express.Multer.File & { location?: string };

export const addTestToAppointmentController = asyncHandler(
  async (req: Request, res: Response) => {
    const { appointmentId, patientId, doctorId, testId, testIds } =
      req.validatedBody;
    const clinicId = req.clinicId;
    const performerUserId = req.user.id;
    const reportPdf =
      (req.file as UploadedLocationFile | undefined)?.location || null;

    // Normalize test IDs into an array
    let testIdArray: string[] = [];

    if (testIds && Array.isArray(testIds)) {
      // If testIds array is provided
      testIdArray = testIds;
    } else if (testId) {
      // If single testId is provided
      testIdArray = Array.isArray(testId) ? testId : [testId];
    }

    if (testIdArray.length === 0) {
      throw new HttpError(400, 'At least one test ID must be provided');
    }

    // Call service with multiple test IDs
    const results = await AppointmentTestService.addTestsToAppointment(
      appointmentId,
      testIdArray,
      patientId,
      doctorId,
      reportPdf,
      performerUserId,
      clinicId
    );

    return res.status(201).json({
      success: true,
      count: results.length,
      results,
    });
  }
);

export const createIndependentLabTestController = asyncHandler(
  async (req: Request, res: Response) => {
    const {
      testIds,
      patientName,
      patientMobile,
      patientAge,
      patientGender,
      doctorName,
    } = req.validatedBody;

    const results = await AppointmentTestService.addIndependentTests({
      testIds,
      patientName,
      patientMobile,
      patientAge,
      patientGender,
      doctorName,
      performerUserId: req.user.id,
      clinicId: req.clinicId,
      labId: req.labId,
    });

    return res.status(201).json({
      success: true,
      count: results.length,
      results,
    });
  }
);

export const removeTestFromAppointmentController = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.validatedParams;
    const result = await AppointmentTestService.removeTestFromAppointment(id);
    res.status(200).json({
      success: true,
      message: 'Test removed from appointment',
      result,
    });
  }
);

export const getTestsByAppointmentIdController = asyncHandler(
  async (req: Request, res: Response) => {
    const { appointmentId } = req.validatedParams;
    const result =
      await AppointmentTestService.getTestsByAppointmentId(appointmentId);
    res.status(200).json({ success: true, result });
  }
);

export const getTestsByPatientIdController = asyncHandler(
  async (req: Request, res: Response) => {
    const { patientId } = req.validatedParams;
    const result = await AppointmentTestService.getTestsByPatientId(patientId);
    res.status(200).json({ success: true, result });
  }
);
export const updateAppointmentTestController = asyncHandler(
  async (req: Request, res: Response) => {
    const appointmentTestId = req.params.appointmentTestId as string; // <-- FIXED
    const clinicId = req.clinicId;
    const { doctorId, labAssistantId, reportStatus, paymentStatus } = req.body;
    const reportPdf = (req.file as UploadedLocationFile | undefined)?.location;
    const userRole = req.user?.userType;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payload: any = {};
    if (doctorId) payload.doctorId = doctorId;
    if (labAssistantId) payload.labAssistantId = labAssistantId;
    if (reportStatus) payload.reportStatus = reportStatus;
    if (paymentStatus) payload.paymentStatus = paymentStatus;
    if (reportPdf) payload.reportPdf = reportPdf;

    // ✅ Auto mark as Completed if report PDF is uploaded
    if (reportPdf) {
      payload.reportPdf = reportPdf;
      payload.reportStatus = 'Completed'; // <-- Auto update status
    }

    // 3️⃣ NEW LOGIC → Auto assign lab assistant when status = "InProgress"
    if (userRole === 'Lab_Assistant' && reportStatus === 'InProgress') {
      payload.labAssistantId = req.user.id; // <-- Auto assign
    }
    const result = await AppointmentTestService.updateAppointmentTest(
      appointmentTestId, // <-- FIXED
      payload,
      req.user.id, // Pass performer user ID
      clinicId // Pass clinic ID
    );

    return res.status(200).json({
      success: true,
      result,
    });
  }
);

export const getLabAppointmentTestsController = asyncHandler(
  async (req: Request, res: Response) => {
    const result = await AppointmentTestService.getLabAppointmentTests(
      req.clinicId,
      req.labId,
      req.user.id,
      req.validatedQuery
    );

    return res.status(200).json({
      success: true,
      labName: result.labName,
      lab: result.lab,
      data: 'data' in result ? result.data : result.tests,
      pagination: result.pagination,
      dashboard: result.dashboard,
    });
  }
);

export const markAppointmentTestOnHoldController = asyncHandler(
  async (req: Request, res: Response) => {
    const { appointmentTestId } = req.validatedParams;
    const result = await AppointmentTestService.markOnHold(
      appointmentTestId,
      req.validatedBody,
      {
        clinicId: req.clinicId,
        labId: req.labId,
        userId: req.user.id,
      }
    );

    return res.status(200).json({
      success: true,
      message: 'Test accepted and moved to pending successfully',
      data: result,
    });
  }
);

export const rejectAppointmentTestController = asyncHandler(
  async (req: Request, res: Response) => {
    const { appointmentTestId } = req.validatedParams;
    const result = await AppointmentTestService.rejectAppointmentTest(
      appointmentTestId,
      req.validatedBody,
      {
        clinicId: req.clinicId,
        labId: req.labId,
        userId: req.user.id,
      }
    );

    return res.status(200).json({
      success: true,
      message: 'Test rejected successfully',
      data: result,
    });
  }
);

export const getSampleTrackingDetailController = asyncHandler(
  async (req: Request, res: Response) => {
    const { appointmentTestId } = req.validatedParams;
    const result = await AppointmentTestService.getSampleTrackingDetail(
      appointmentTestId,
      {
        clinicId: req.clinicId,
        labId: req.labId,
        userId: req.user.id,
      }
    );

    return res.status(200).json({
      success: true,
      data: result,
    });
  }
);

export const getLabInvoiceByAppointmentTestController = asyncHandler(
  async (req: Request, res: Response) => {
    const { appointmentTestId } = req.validatedParams;
    const result = await AppointmentTestService.getLabInvoiceByAppointmentTest(
      appointmentTestId,
      {
        clinicId: req.clinicId,
        labId: req.labId,
        userId: req.user.id,
      }
    );

    return res.status(200).json({
      success: true,
      data: result,
    });
  }
);

export const getLabInvoiceByIdController = asyncHandler(
  async (req: Request, res: Response) => {
    const { invoiceId } = req.validatedParams;
    const result = await AppointmentTestService.getLabInvoiceById(invoiceId, {
      clinicId: req.clinicId,
      labId: req.labId,
      userId: req.user.id,
    });

    return res.status(200).json({
      success: true,
      data: result,
    });
  }
);

export const getAppointmentTestBarcodeController = asyncHandler(
  async (req: Request, res: Response) => {
    const { appointmentTestId } = req.validatedParams;
    const result = await AppointmentTestService.getAppointmentTestBarcode(
      appointmentTestId,
      {
        clinicId: req.clinicId,
        labId: req.labId,
        userId: req.user.id,
      }
    );

    return res.status(200).json({
      success: true,
      data: result,
    });
  }
);

export const getSampleTrackingDetailByBarcodeController = asyncHandler(
  async (req: Request, res: Response) => {
    const { barcodeValue } = req.validatedParams;
    const result =
      await AppointmentTestService.getSampleTrackingDetailByBarcode(
        barcodeValue,
        {
          clinicId: req.clinicId,
          labId: req.labId,
          userId: req.user.id,
        }
      );

    return res.status(200).json({
      success: true,
      data: result,
    });
  }
);

export const getBarcodeLookupController = asyncHandler(
  async (req: Request, res: Response) => {
    const { barcodeValue } = req.validatedParams;
    const result = await AppointmentTestService.getBarcodeLookup(barcodeValue, {
      clinicId: req.clinicId,
      labId: req.labId,
      userId: req.user.id,
    });

    return res.status(200).json({
      success: true,
      data: result,
    });
  }
);

export const getBarcodePrintDataController = asyncHandler(
  async (req: Request, res: Response) => {
    const { barcodeValue } = req.validatedParams;
    const result = await AppointmentTestService.getBarcodePrintData(
      barcodeValue,
      {
        clinicId: req.clinicId,
        labId: req.labId,
        userId: req.user.id,
      }
    );

    return res.status(200).json({
      success: true,
      data: result,
    });
  }
);

export const updateSampleStatusByBarcodeController = asyncHandler(
  async (req: Request, res: Response) => {
    const { barcodeValue } = req.validatedParams;
    const result = await AppointmentTestService.updateSampleStatusByBarcode(
      barcodeValue,
      req.validatedBody,
      {
        clinicId: req.clinicId,
        labId: req.labId,
        userId: req.user.id,
      }
    );

    return res.status(200).json({
      success: true,
      message: 'Sample status updated successfully',
      data: result,
    });
  }
);

export const markAppointmentTestPaymentPaidController = asyncHandler(
  async (req: Request, res: Response) => {
    const { appointmentTestId } = req.validatedParams;
    const result = await AppointmentTestService.markPaymentPaid(
      appointmentTestId,
      req.validatedBody,
      {
        clinicId: req.clinicId,
        labId: req.labId,
        userId: req.user.id,
      }
    );

    return res.status(200).json({
      success: true,
      message: 'Payment marked as paid',
      data: result,
    });
  }
);

export const setExpectedReportReadyAtController = asyncHandler(
  async (req: Request, res: Response) => {
    const { appointmentTestId } = req.validatedParams;
    const result = await AppointmentTestService.setExpectedReportReadyAt(
      appointmentTestId,
      req.validatedBody,
      {
        clinicId: req.clinicId,
        labId: req.labId,
        userId: req.user.id,
      }
    );

    return res.status(200).json({
      success: true,
      message: 'Expected report ready time updated successfully',
      data: result,
    });
  }
);

export const updateAppointmentTestSampleStatusController = asyncHandler(
  async (req: Request, res: Response) => {
    const { appointmentTestId } = req.validatedParams;
    const { action, expectedReportReadyAt, note } = req.validatedBody;
    const context = {
      clinicId: req.clinicId,
      labId: req.labId,
      userId: req.user.id,
    };

    const result =
      action === 'SET_EXPECTED_REPORT_READY_AT'
        ? await AppointmentTestService.setExpectedReportReadyAt(
            appointmentTestId,
            { expectedReportReadyAt, note },
            context
          )
        : await AppointmentTestService.updateSampleStatus(
            appointmentTestId,
            action,
            context
          );

    return res.status(200).json({
      success: true,
      message: 'Sample status updated successfully',
      data: result,
    });
  }
);

// export const getAppointmentTestByIdController = asyncHandler(
//   async (req: Request, res: Response) => {
//     const { appointmentTestId } = req.params;

//     const result = await AppointmentTestService.getAppointmentTestById(
//       appointmentTestId
//     );
