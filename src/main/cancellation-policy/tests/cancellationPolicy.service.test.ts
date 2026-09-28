import { PolicyEvaluationService } from '../services/policyEvaluation.service';
import { database } from '../../../configurations/dbConnection';
import { HttpError } from '../../../middlewear/errorHandler';

jest.mock('../../../configurations/dbConnection');

describe('PolicyEvaluationService Unit Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const createChain = (finalValue: any) => {
    const chain: any = {};
    const methods = [
      'from',
      'leftJoin',
      'innerJoin',
      'where',
      '$dynamic',
      'orderBy',
      'limit',
      'offset',
    ];
    methods.forEach((method) => {
      chain[method] = jest.fn().mockImplementation(() => chain);
    });
    chain.then = (resolve: any) => resolve(finalValue);
    return chain;
  };

  describe('evaluateCancellation', () => {
    it('should throw error if cancellation feature is disabled globally', async () => {
      const mockAppPolicy = [
        {
          cancellationFeatureEnabled: false,
          refundFeatureEnabled: true,
          rescheduleFeatureEnabled: true,
        },
      ];
      (database.select as jest.Mock).mockReturnValueOnce(
        createChain(mockAppPolicy)
      );

      await expect(
        PolicyEvaluationService.evaluateCancellation(
          'appt-id',
          'user-id',
          'Patient',
          { reasonCode: 'patient_requested' }
        )
      ).rejects.toThrow(
        new HttpError(
          400,
          'Cancellation feature is temporarily disabled by the platform',
          'CANCELLATION_DISABLED'
        )
      );
    });

    it('should throw error if appointment is in blocked state (e.g. Completed)', async () => {
      const mockAppPolicy = [
        {
          cancellationFeatureEnabled: true,
          refundFeatureEnabled: true,
          rescheduleFeatureEnabled: true,
        },
      ];
      const mockAppt = [
        {
          id: 'appt-id',
          appointmentStatus: 'Completed',
          doctorId: 'doctor-id',
          clinicId: 'clinic-id',
          appointmentDate: new Date(),
        },
      ];

      (database.select as jest.Mock)
        .mockReturnValueOnce(createChain(mockAppPolicy))
        .mockReturnValueOnce(createChain(mockAppt));

      await expect(
        PolicyEvaluationService.evaluateCancellation(
          'appt-id',
          'user-id',
          'Patient',
          { reasonCode: 'patient_requested' }
        )
      ).rejects.toThrow(
        new HttpError(
          400,
          "Appointment in state 'Completed' cannot be cancelled",
          'INVALID_APPOINTMENT_STATE'
        )
      );
    });

    it('should throw error if clinic policy disables cancellation rights for patients', async () => {
      const mockAppPolicy = [
        {
          cancellationFeatureEnabled: true,
          refundFeatureEnabled: true,
          rescheduleFeatureEnabled: true,
        },
      ];
      const mockAppt = [
        {
          id: 'appt-id',
          appointmentStatus: 'Upcoming',
          doctorId: 'doctor-id',
          clinicId: 'clinic-id',
          clinicCancellationPolicyId: 'policy-id',
          appointmentDate: new Date(Date.now() + 48 * 60 * 60 * 1000), // 48h in future
        },
      ];
      const mockClinicPolicy = [
        {
          id: 'policy-id',
          clinicId: 'clinic-id',
          allowPatientCancel: false,
          isActive: true,
        },
      ];

      (database.select as jest.Mock)
        .mockReturnValueOnce(createChain(mockAppPolicy))
        .mockReturnValueOnce(createChain(mockAppt))
        .mockReturnValueOnce(createChain(mockClinicPolicy));

      await expect(
        PolicyEvaluationService.evaluateCancellation(
          'appt-id',
          'user-id',
          'Patient',
          { reasonCode: 'patient_requested' }
        )
      ).rejects.toThrow(
        new HttpError(
          403,
          'Patients are not permitted to cancel appointments under clinic policy',
          'INSUFFICIENT_USER_RIGHTS'
        )
      );
    });

    it('should throw error if patient cancels within the clinic window limit (e.g. 5 hours left, policy requires 24 hours)', async () => {
      const mockAppPolicy = [
        {
          cancellationFeatureEnabled: true,
          refundFeatureEnabled: true,
          rescheduleFeatureEnabled: true,
        },
      ];
      const mockAppt = [
        {
          id: 'appt-id',
          appointmentStatus: 'Upcoming',
          doctorId: 'doctor-id',
          clinicId: 'clinic-id',
          clinicCancellationPolicyId: 'policy-id',
          appointmentType: 'Online',
          appointmentDate: new Date(Date.now() + 5 * 60 * 60 * 1000), // 5h in future
        },
      ];
      const mockClinicPolicy = [
        {
          id: 'policy-id',
          clinicId: 'clinic-id',
          allowPatientCancel: true,
          windowOnlineHours: 24,
          reasonMandatory: false,
          isActive: true,
        },
      ];

      (database.select as jest.Mock)
        .mockReturnValueOnce(createChain(mockAppPolicy))
        .mockReturnValueOnce(createChain(mockAppt))
        .mockReturnValueOnce(createChain(mockClinicPolicy));

      await expect(
        PolicyEvaluationService.evaluateCancellation(
          'appt-id',
          'user-id',
          'Patient',
          { reasonCode: 'patient_requested' }
        )
      ).rejects.toThrow(
        new HttpError(
          400,
          'Cancellation window has passed. Minimum buffer required is 24 hours.',
          'CANCELLATION_WINDOW_VIOLATION'
        )
      );
    });

    it('should throw 429 error with dynamic remaining time if cooldown is active', async () => {
      const mockAppPolicy = [
        {
          cancellationFeatureEnabled: true,
          refundFeatureEnabled: true,
          rescheduleFeatureEnabled: true,
        },
      ];
      const mockAppt = [
        {
          id: 'appt-id',
          appointmentStatus: 'Upcoming',
          doctorId: 'doctor-id',
          clinicId: 'clinic-id',
          clinicCancellationPolicyId: 'policy-id',
          appointmentType: 'Online',
          appointmentDate: new Date(Date.now() + 48 * 60 * 60 * 1000), // 48h in future (bypasses window check)
        },
      ];
      const mockClinicPolicy = [
        {
          id: 'policy-id',
          clinicId: 'clinic-id',
          allowPatientCancel: true,
          windowOnlineHours: 24,
          cooldownSecondsBetweenCancellations: 1800, // 30 minutes cooldown
          reasonMandatory: false,
          isActive: true,
        },
      ];
      const mockLastRequest = [
        {
          id: 'request-id',
          userId: 'user-id',
          userRole: 'Patient',
          createdAt: new Date(Date.now() - 10 * 60 * 1000), // 10 minutes ago
        },
      ];

      (database.select as jest.Mock)
        .mockReturnValueOnce(createChain(mockAppPolicy))
        .mockReturnValueOnce(createChain(mockAppt))
        .mockReturnValueOnce(createChain(mockClinicPolicy))
        .mockReturnValueOnce(createChain(mockLastRequest));

      await expect(
        PolicyEvaluationService.evaluateCancellation(
          'appt-id',
          'user-id',
          'Patient',
          { reasonCode: 'patient_requested' }
        )
      ).rejects.toThrow(
        new HttpError(
          429,
          'Please wait before initiating another cancellation request. Next cancellation window will open after 20 minutes.',
          'COOLDOWN_VIOLATION'
        )
      );
    });
  });

  describe('calculateRefund', () => {
    it('should return 100% refund type Full if cancellation is made > 24 hours in advance', async () => {
      const mockPayment = [
        {
          id: 'pay-id',
          appointmentId: 'appt-id',
          price: '500.00',
          paymentStatus: 'Paid',
          paymentMode: 'razorpay',
        },
      ];
      const mockAppPolicy = [
        {
          refundFeatureEnabled: true,
          defaultRefundCooldownHours: 24,
          defaultRefundPercentage: 100,
          partialRefundCooldownHours: 12,
          partialRefundPercentage: 50,
        },
      ];
      const mockAppt = [
        {
          id: 'appt-id',
          appointmentDate: new Date(Date.now() + 36 * 60 * 60 * 1000), // 36 hours in future
        },
      ];

      (database.select as jest.Mock)
        .mockReturnValueOnce(createChain(mockPayment))
        .mockReturnValueOnce(createChain(mockAppPolicy))
        .mockReturnValueOnce(createChain(mockAppt));

      const refund = await PolicyEvaluationService.calculateRefund('appt-id');
      expect(refund.eligible).toBe(true);
      expect(refund.refundType).toBe('Full');
      expect(refund.refundAmount).toBe(500);
    });

    it('should return 50% refund type Partial if cancellation is made between 12 and 24 hours in advance', async () => {
      const mockPayment = [
        {
          id: 'pay-id',
          appointmentId: 'appt-id',
          price: '500.00',
          paymentStatus: 'Paid',
          paymentMode: 'razorpay',
        },
      ];
      const mockAppPolicy = [
        {
          refundFeatureEnabled: true,
          defaultRefundCooldownHours: 24,
          defaultRefundPercentage: 100,
          partialRefundCooldownHours: 12,
          partialRefundPercentage: 50,
        },
      ];
      const mockAppt = [
        {
          id: 'appt-id',
          appointmentDate: new Date(Date.now() + 15 * 60 * 60 * 1000), // 15 hours in future (between 12 and 24)
        },
      ];

      (database.select as jest.Mock)
        .mockReturnValueOnce(createChain(mockPayment))
        .mockReturnValueOnce(createChain(mockAppPolicy))
        .mockReturnValueOnce(createChain(mockAppt));

      const refund = await PolicyEvaluationService.calculateRefund('appt-id');
      expect(refund.eligible).toBe(true);
      expect(refund.refundType).toBe('Partial');
      expect(refund.refundAmount).toBe(250);
    });

    it('should return 0% refund type None if cancellation is made < 12 hours in advance', async () => {
      const mockPayment = [
        {
          id: 'pay-id',
          appointmentId: 'appt-id',
          price: '500.00',
          paymentStatus: 'Paid',
          paymentMode: 'razorpay',
        },
      ];
      const mockAppPolicy = [
        {
          refundFeatureEnabled: true,
          defaultRefundCooldownHours: 24,
          defaultRefundPercentage: 100,
          partialRefundCooldownHours: 12,
          partialRefundPercentage: 50,
        },
      ];
      const mockAppt = [
        {
          id: 'appt-id',
          appointmentDate: new Date(Date.now() + 8 * 60 * 60 * 1000), // 8 hours in future
        },
      ];

      (database.select as jest.Mock)
        .mockReturnValueOnce(createChain(mockPayment))
        .mockReturnValueOnce(createChain(mockAppPolicy))
        .mockReturnValueOnce(createChain(mockAppt));

      const refund = await PolicyEvaluationService.calculateRefund('appt-id');
      expect(refund.eligible).toBe(false);
      expect(refund.refundType).toBe('None');
      expect(refund.refundAmount).toBe(0);
    });
  });
});
