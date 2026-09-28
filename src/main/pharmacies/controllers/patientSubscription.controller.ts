import { Request, Response } from 'express';
import { asyncHandler } from '../../../middlewear/errorHandler';
import { PharmacySupplierService } from '../services/supplier.service';
import {
  CreateSubscriptionInput,
  GetSubscriptionsNotificationQuery,
  GetSubscriptionsQuery,
  UpdateSubscriptionInput,
} from '../schemas/patientSubscription.schema';
import { PatientSubscriptionService } from '../services/patientSubscription.service';

export const createPatientSubscriptionController = asyncHandler(
  async (req: Request, res: Response) => {
    const payload = req.validatedBody as CreateSubscriptionInput;
    const userId = (req.user as { id: string }).id;
    const pharmacyId = await PharmacySupplierService.getUserPharmacyId(userId);

    const result = await PatientSubscriptionService.createPatientSubscription(
      payload,
      pharmacyId
    );

    res.status(201).json({
      success: true,
      message: 'Subscription created successfully',
      data: result,
    });
  }
);

export const updatePatientSubscriptionController = asyncHandler(
  async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const payload = req.validatedBody as UpdateSubscriptionInput;
    const userId = (req.user as { id: string }).id;
    const pharmacyId = await PharmacySupplierService.getUserPharmacyId(userId);

    const result = await PatientSubscriptionService.updatePatientSubscription(
      id,
      payload,
      pharmacyId
    );

    res.json({
      success: true,
      message: 'Subscription updated successfully',
      data: result,
    });
  }
);

export const getPatientSubscriptionsController = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = (req.user as { id: string }).id;
    const pharmacyId = await PharmacySupplierService.getUserPharmacyId(userId);
    const query = req.validatedQuery as GetSubscriptionsQuery;

    const result = await PatientSubscriptionService.getPatientSubscriptions(
      pharmacyId,
      query
    );

    res.json({
      success: true,
      data: result.subscriptions,
      pagination: result.pagination,
    });
  }
);

export const getPatientSubscriptionByIdController = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = (req.user as { id: string }).id;
    const { id } = req.params as { id: string };
    const pharmacyId = await PharmacySupplierService.getUserPharmacyId(userId);

    const result = await PatientSubscriptionService.getPatientSubscriptionById(
      id,
      pharmacyId
    );

    res.json({ success: true, data: result });
  }
);

export const getSubscriptionSalesController = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = (req.user as { id: string }).id;
    const pharmacyId = await PharmacySupplierService.getUserPharmacyId(userId);

    const subscriptionId = req.params.subscriptionId as string;
    const query = req.validatedQuery as GetSubscriptionsNotificationQuery;

    const result = await PatientSubscriptionService.getSubscriptionSales(
      pharmacyId,
      subscriptionId,
      query
    );

    res.json({
      success: true,
      data: result.sales,
      pagination: result.pagination,
    });
  }
);

export const getPatientSubscriptionsNotificationController = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = (req.user as { id: string }).id;
    const pharmacyId = await PharmacySupplierService.getUserPharmacyId(userId);
    const query = req.validatedQuery as GetSubscriptionsNotificationQuery;

    const result =
      await PatientSubscriptionService.getPatientSubscriptionsNotification(
        pharmacyId,
        query
      );

    res.json({
      success: true,
      data: result.subscriptions,
      pagination: result.pagination,
    });
  }
);

export const markSubscriptionNotificationReadController = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = (req.user as { id: string }).id;
    const pharmacyId = await PharmacySupplierService.getUserPharmacyId(userId);

    const result =
      await PatientSubscriptionService.markSubscriptionNotificationRead(
        pharmacyId
      );

    res.json({
      success: true,
      data: result,
    });
  }
);

export const updateNextDeliveryDateController = asyncHandler(
  async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const { nextDeliveryDate } = req.body;
    const userId = (req.user as { id: string }).id;
    const pharmacyId = await PharmacySupplierService.getUserPharmacyId(userId);

    const result = await PatientSubscriptionService.updateNextDeliveryDate(
      id,
      nextDeliveryDate,
      pharmacyId
    );

    res.json({
      success: true,
      message: 'Next delivery date updated successfully',
      data: result,
    });
  }
);

export const getPatientSubscriptionStatsController = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = (req.user as { id: string }).id;
    const pharmacyId = await PharmacySupplierService.getUserPharmacyId(userId);

    const result =
      await PatientSubscriptionService.getPatientSubscriptionStats(pharmacyId);

    res.json({
      success: true,
      message: 'Subscription statistics retrieved successfully',
      data: result,
    });
  }
);
