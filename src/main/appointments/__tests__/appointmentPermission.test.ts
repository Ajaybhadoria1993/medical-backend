import { Request, Response } from 'express';
import {
  requirePaymentPermissionForPayload,
  requireWalkInPermissionForPayload,
} from '../middlewares/appointmentPermission.middleware';
import { PermissionService } from '../../permissions/services/permission.service';
import { PERMISSION_KEYS } from '../../permissions/utils/permission.constants';

describe('appointmentPermission middleware', () => {
  let hasPermissionSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    hasPermissionSpy = jest.spyOn(PermissionService, 'hasPermission');
  });

  afterEach(() => {
    hasPermissionSpy.mockRestore();
  });

  describe('requirePaymentPermissionForPayload', () => {
    it('should bypass non-scoped roles (e.g. Admin)', async () => {
      const req = {
        user: { id: 'admin-1', userType: 'Admin' },
        clinicId: 'clinic-1',
        body: { paymentMode: 'Cash', paymentStatus: 'Paid' },
      } as unknown as Request;
      const res = {} as Response;
      const next = jest.fn();

      await requirePaymentPermissionForPayload(req, res, next);

      expect(next).toHaveBeenCalledWith();
      expect(hasPermissionSpy).not.toHaveBeenCalled();
    });

    it('should allow Receptionist creating an appointment with Pay Later without requiring payment:manage', async () => {
      const req = {
        user: { id: 'rec-1', userType: 'Receptionist' },
        clinicId: 'clinic-1',
        method: 'POST',
        body: { paymentMode: 'Pay Later', paymentStatus: 'Pending' },
      } as unknown as Request;
      const res = {} as Response;
      const next = jest.fn();

      await requirePaymentPermissionForPayload(req, res, next);

      expect(next).toHaveBeenCalledWith();
      expect(hasPermissionSpy).not.toHaveBeenCalled();
    });

    it('should reject Receptionist without payment:manage when trying to create appointment with Cash', async () => {
      hasPermissionSpy.mockResolvedValue(false);

      const req = {
        user: { id: 'rec-1', userType: 'Receptionist' },
        clinicId: 'clinic-1',
        method: 'POST',
        body: { paymentMode: 'Cash' },
      } as unknown as Request;
      const res = {} as Response;
      const next = jest.fn();

      await requirePaymentPermissionForPayload(req, res, next);

      expect(hasPermissionSpy).toHaveBeenCalledWith(
        'rec-1',
        'Receptionist',
        'clinic-1',
        PERMISSION_KEYS.PAYMENT_MANAGE
      );
      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 403,
          message: 'You do not have permission to collect or update payments.',
        })
      );
    });

    it('should allow Receptionist WITH payment:manage when creating appointment with Cash', async () => {
      hasPermissionSpy.mockResolvedValue(true);

      const req = {
        user: { id: 'rec-1', userType: 'Receptionist' },
        clinicId: 'clinic-1',
        method: 'POST',
        body: { paymentMode: 'Cash' },
      } as unknown as Request;
      const res = {} as Response;
      const next = jest.fn();

      await requirePaymentPermissionForPayload(req, res, next);

      expect(hasPermissionSpy).toHaveBeenCalledWith(
        'rec-1',
        'Receptionist',
        'clinic-1',
        PERMISSION_KEYS.PAYMENT_MANAGE
      );
      expect(next).toHaveBeenCalledWith();
    });

    it('should enforce payment:manage on Nurse attempting to collect payment', async () => {
      hasPermissionSpy.mockResolvedValue(false);

      const req = {
        user: { id: 'nurse-1', userType: 'Nurse' },
        clinicId: 'clinic-1',
        method: 'POST',
        body: { paymentMode: 'UPI' },
      } as unknown as Request;
      const res = {} as Response;
      const next = jest.fn();

      await requirePaymentPermissionForPayload(req, res, next);

      expect(hasPermissionSpy).toHaveBeenCalledWith(
        'nurse-1',
        'Nurse',
        'clinic-1',
        PERMISSION_KEYS.PAYMENT_MANAGE
      );
      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 403,
          message: 'You do not have permission to collect or update payments.',
        })
      );
    });

    it('should enforce payment:manage on PUT appointment update when refund fields are present', async () => {
      hasPermissionSpy.mockResolvedValue(false);

      const req = {
        user: { id: 'rec-1', userType: 'Receptionist' },
        clinicId: 'clinic-1',
        method: 'PUT',
        body: { refundMode: 'Cash', refundedAmount: 500 },
      } as unknown as Request;
      const res = {} as Response;
      const next = jest.fn();

      await requirePaymentPermissionForPayload(req, res, next);

      expect(hasPermissionSpy).toHaveBeenCalledWith(
        'rec-1',
        'Receptionist',
        'clinic-1',
        PERMISSION_KEYS.PAYMENT_MANAGE
      );
      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 403,
        })
      );
    });

    it('should require payment:manage for a Nurse creating an appointment with a price and no explicit payment mode (service derives "Paid")', async () => {
      hasPermissionSpy.mockResolvedValue(false);

      const req = {
        user: { id: 'nurse-1', userType: 'Nurse' },
        clinicId: 'clinic-1',
        method: 'POST',
        body: { price: '500' },
      } as unknown as Request;
      const res = {} as Response;
      const next = jest.fn();

      await requirePaymentPermissionForPayload(req, res, next);

      expect(hasPermissionSpy).toHaveBeenCalledWith(
        'nurse-1',
        'Nurse',
        'clinic-1',
        PERMISSION_KEYS.PAYMENT_MANAGE
      );
      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ status: 403 })
      );
    });

    it('should let a Nurse with payment:manage create an implicitly-paid appointment', async () => {
      hasPermissionSpy.mockResolvedValue(true);

      const req = {
        user: { id: 'nurse-1', userType: 'Nurse' },
        clinicId: 'clinic-1',
        method: 'POST',
        body: { price: '500' },
      } as unknown as Request;
      const res = {} as Response;
      const next = jest.fn();

      await requirePaymentPermissionForPayload(req, res, next);

      expect(next).toHaveBeenCalledWith();
    });
  });

  describe('requireWalkInPermissionForPayload', () => {
    it('should enforce appointment:walkin on scoped roles booking walk_in', async () => {
      hasPermissionSpy.mockResolvedValue(false);

      const req = {
        user: { id: 'nurse-1', userType: 'Nurse' },
        clinicId: 'clinic-1',
        body: { bookingSource: 'walk_in' },
      } as unknown as Request;
      const res = {} as Response;
      const next = jest.fn();

      await requireWalkInPermissionForPayload(req, res, next);

      expect(hasPermissionSpy).toHaveBeenCalledWith(
        'nurse-1',
        'Nurse',
        'clinic-1',
        PERMISSION_KEYS.APPOINTMENT_WALKIN
      );
      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 403,
          message: 'You do not have permission to add walk-in patients.',
        })
      );
    });
  });
});
