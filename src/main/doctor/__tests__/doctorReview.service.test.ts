import { DoctorReviewService } from '../services/doctorReview.service';
import { database } from '../../../configurations/dbConnection';
import { HttpError } from '../../../middlewear/errorHandler';

jest.mock('../../../configurations/dbConnection');
jest.mock('../../../utils/logger');

describe('DoctorReviewService Unit Tests', () => {
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
      'limit',
      'offset',
      'orderBy',
      'returning',
      'set',
      'values',
    ];
    methods.forEach((method) => {
      chain[method] = jest.fn().mockImplementation(() => chain);
    });
    chain.then = (resolve: any) => resolve(finalValue);
    return chain;
  };

  describe('createReview', () => {
    it('should throw HttpError (400) if no completed or cancelled appointment is found', async () => {
      const mockAppointmentCheck: any[] = [];
      const selectChain = createChain(mockAppointmentCheck);
      (database.select as jest.Mock).mockReturnValue(selectChain);

      await expect(
        DoctorReviewService.createReview('patient-1', {
          appointmentId: 'appt-1',
          doctorId: 'doctor-1',
          rating: 5,
          reviewText: 'Great doctor!',
        })
      ).rejects.toThrow(
        new HttpError(
          400,
          'Only completed or cancelled appointments can be rated and reviewed'
        )
      );
    });

    it('should throw HttpError (400) if appointment has already been reviewed', async () => {
      const mockAppointmentCheck = [{ id: 'appt-1', patientId: 'patient-1' }];
      const mockDuplicateCheck = [{ id: 'review-1' }];

      const apptChain = createChain(mockAppointmentCheck);
      const dupChain = createChain(mockDuplicateCheck);

      (database.select as jest.Mock)
        .mockReturnValueOnce(apptChain)
        .mockReturnValueOnce(dupChain);

      await expect(
        DoctorReviewService.createReview('patient-1', {
          appointmentId: 'appt-1',
          doctorId: 'doctor-1',
          rating: 5,
          reviewText: 'Great doctor!',
        })
      ).rejects.toThrow(
        new HttpError(400, 'This appointment has already been reviewed')
      );
    });

    it('should successfully create a review and trigger rating recalculation inside transaction', async () => {
      const mockAppointmentCheck = [{ id: 'appt-1', patientId: 'patient-1' }];
      const mockDuplicateCheck: any[] = [];
      const mockInsertedReview = [{ id: 'review-1', rating: 5 }];
      const mockRecalcAggregate = [{ averageRating: '4.50', reviewCount: 10 }];

      const apptChain = createChain(mockAppointmentCheck);
      const dupChain = createChain(mockDuplicateCheck);
      const insertChain = createChain(mockInsertedReview);
      const selectAggregateChain = createChain(mockRecalcAggregate);
      const updateProfessionalChain = createChain([]);

      (database.select as jest.Mock)
        .mockReturnValueOnce(apptChain)
        .mockReturnValueOnce(dupChain);

      const txMock = {
        insert: jest.fn().mockReturnValue(insertChain),
        select: jest.fn().mockReturnValue(selectAggregateChain),
        update: jest.fn().mockReturnValue(updateProfessionalChain),
      };

      (database.transaction as jest.Mock).mockImplementation(async (cb) => {
        return cb(txMock);
      });

      const result = await DoctorReviewService.createReview('patient-1', {
        appointmentId: 'appt-1',
        doctorId: 'doctor-1',
        rating: 5,
        reviewText: 'Great doctor!',
      });

      expect(txMock.insert).toHaveBeenCalled();
      expect(txMock.select).toHaveBeenCalled();
      expect(txMock.update).toHaveBeenCalled();
      expect(result).toEqual({ id: 'review-1', rating: 5 });
    });

    it('should successfully create a review for a family member appointment', async () => {
      const mockAppointmentCheck = [
        { id: 'appt-1', patientId: 'family-member-1' },
      ];
      const mockFamilyLinkCheck = [{ id: 'link-1' }];
      const mockDuplicateCheck: any[] = [];
      const mockInsertedReview = [{ id: 'review-1', rating: 5 }];
      const mockRecalcAggregate = [{ averageRating: '4.50', reviewCount: 10 }];

      const apptChain = createChain(mockAppointmentCheck);
      const familyChain = createChain(mockFamilyLinkCheck);
      const dupChain = createChain(mockDuplicateCheck);
      const insertChain = createChain(mockInsertedReview);
      const selectAggregateChain = createChain(mockRecalcAggregate);
      const updateProfessionalChain = createChain([]);

      (database.select as jest.Mock)
        .mockReturnValueOnce(apptChain)
        .mockReturnValueOnce(familyChain)
        .mockReturnValueOnce(dupChain);

      const txMock = {
        insert: jest.fn().mockReturnValue(insertChain),
        select: jest.fn().mockReturnValue(selectAggregateChain),
        update: jest.fn().mockReturnValue(updateProfessionalChain),
      };

      (database.transaction as jest.Mock).mockImplementation(async (cb) => {
        return cb(txMock);
      });

      const result = await DoctorReviewService.createReview('patient-1', {
        appointmentId: 'appt-1',
        doctorId: 'doctor-1',
        rating: 5,
        reviewText: 'Great doctor!',
      });

      expect(txMock.insert).toHaveBeenCalled();
      expect(txMock.select).toHaveBeenCalled();
      expect(txMock.update).toHaveBeenCalled();
      expect(result).toEqual({ id: 'review-1', rating: 5 });
    });

    it('should throw HttpError (400) if patient is not the primary patient nor linked to the appointment patient', async () => {
      const mockAppointmentCheck = [
        { id: 'appt-1', patientId: 'some-other-patient' },
      ];
      const mockFamilyLinkCheck: any[] = [];

      const apptChain = createChain(mockAppointmentCheck);
      const familyChain = createChain(mockFamilyLinkCheck);

      (database.select as jest.Mock)
        .mockReturnValueOnce(apptChain)
        .mockReturnValueOnce(familyChain);

      await expect(
        DoctorReviewService.createReview('patient-1', {
          appointmentId: 'appt-1',
          doctorId: 'doctor-1',
          rating: 5,
          reviewText: 'Great doctor!',
        })
      ).rejects.toThrow(
        new HttpError(
          400,
          'Only completed or cancelled appointments can be rated and reviewed'
        )
      );
    });
  });

  describe('updateReview', () => {
    it('should throw HttpError (404) if review does not exist', async () => {
      const mockSelect: any[] = [];
      const selectChain = createChain(mockSelect);
      (database.select as jest.Mock).mockReturnValue(selectChain);

      await expect(
        DoctorReviewService.updateReview('review-1', 'patient-1', { rating: 4 })
      ).rejects.toThrow(new HttpError(404, 'Review not found'));
    });

    it('should throw HttpError (403) if patient is not the author of the review', async () => {
      const mockSelect = [{ id: 'review-1', patientId: 'different-patient' }];
      const selectChain = createChain(mockSelect);
      (database.select as jest.Mock).mockReturnValue(selectChain);

      await expect(
        DoctorReviewService.updateReview('review-1', 'patient-1', { rating: 4 })
      ).rejects.toThrow(
        new HttpError(403, 'You are not authorized to update this review')
      );
    });

    it('should successfully update review and recalculate stats inside transaction', async () => {
      const mockSelect = [
        { id: 'review-1', patientId: 'patient-1', doctorId: 'doctor-1' },
      ];
      const mockUpdated = [{ id: 'review-1', rating: 4 }];
      const mockRecalcAggregate = [{ averageRating: '4.00', reviewCount: 9 }];

      const selectChain = createChain(mockSelect);
      const updateChain = createChain(mockUpdated);
      const selectAggregateChain = createChain(mockRecalcAggregate);
      const updateProfessionalChain = createChain([]);

      (database.select as jest.Mock).mockReturnValueOnce(selectChain);

      const txMock = {
        update: jest
          .fn()
          .mockReturnValueOnce(updateChain)
          .mockReturnValueOnce(updateProfessionalChain),
        select: jest.fn().mockReturnValue(selectAggregateChain),
      };

      (database.transaction as jest.Mock).mockImplementation(async (cb) => {
        return cb(txMock);
      });

      const result = await DoctorReviewService.updateReview(
        'review-1',
        'patient-1',
        { rating: 4 }
      );

      expect(txMock.update).toHaveBeenCalledTimes(2);
      expect(txMock.select).toHaveBeenCalled();
      expect(result).toEqual({ id: 'review-1', rating: 4 });
    });
  });

  describe('deleteReview', () => {
    it('should throw HttpError (404) if review does not exist', async () => {
      const mockSelect: any[] = [];
      const selectChain = createChain(mockSelect);
      (database.select as jest.Mock).mockReturnValue(selectChain);

      await expect(
        DoctorReviewService.deleteReview('review-1', 'patient-1')
      ).rejects.toThrow(new HttpError(404, 'Review not found'));
    });

    it('should throw HttpError (403) if patient is not the author of the review', async () => {
      const mockSelect = [{ id: 'review-1', patientId: 'different-patient' }];
      const selectChain = createChain(mockSelect);
      (database.select as jest.Mock).mockReturnValue(selectChain);

      await expect(
        DoctorReviewService.deleteReview('review-1', 'patient-1')
      ).rejects.toThrow(
        new HttpError(403, 'You are not authorized to delete this review')
      );
    });

    it('should successfully delete review and recalculate stats inside transaction', async () => {
      const mockSelect = [
        { id: 'review-1', patientId: 'patient-1', doctorId: 'doctor-1' },
      ];
      const mockRecalcAggregate = [{ averageRating: '4.20', reviewCount: 8 }];

      const selectChain = createChain(mockSelect);
      const deleteChain = createChain([]);
      const selectAggregateChain = createChain(mockRecalcAggregate);
      const updateProfessionalChain = createChain([]);

      (database.select as jest.Mock).mockReturnValueOnce(selectChain);

      const txMock = {
        delete: jest.fn().mockReturnValue(deleteChain),
        select: jest.fn().mockReturnValue(selectAggregateChain),
        update: jest.fn().mockReturnValue(updateProfessionalChain),
      };

      (database.transaction as jest.Mock).mockImplementation(async (cb) => {
        return cb(txMock);
      });

      const result = await DoctorReviewService.deleteReview(
        'review-1',
        'patient-1'
      );

      expect(txMock.delete).toHaveBeenCalled();
      expect(txMock.select).toHaveBeenCalled();
      expect(txMock.update).toHaveBeenCalled();
      expect(result).toEqual({ success: true });
    });
  });

  describe('replyToReview', () => {
    it('should throw HttpError (404) if review does not exist', async () => {
      const mockSelect: any[] = [];
      const selectChain = createChain(mockSelect);
      (database.select as jest.Mock).mockReturnValue(selectChain);

      await expect(
        DoctorReviewService.replyToReview('review-1', 'doctor-1', 'Thank you!')
      ).rejects.toThrow(new HttpError(404, 'Review not found'));
    });

    it('should throw HttpError (403) if replying doctor is not the review doctor', async () => {
      const mockSelect = [{ id: 'review-1', doctorId: 'different-doctor' }];
      const selectChain = createChain(mockSelect);
      (database.select as jest.Mock).mockReturnValue(selectChain);

      await expect(
        DoctorReviewService.replyToReview('review-1', 'doctor-1', 'Thank you!')
      ).rejects.toThrow(
        new HttpError(403, 'You are not authorized to reply to this review')
      );
    });

    it('should successfully save doctor reply', async () => {
      const mockSelect = [{ id: 'review-1', doctorId: 'doctor-1' }];
      const mockUpdated = [{ id: 'review-1', replyText: 'Thank you!' }];

      const selectChain = createChain(mockSelect);
      const updateChain = createChain(mockUpdated);

      (database.select as jest.Mock).mockReturnValueOnce(selectChain);
      (database.update as jest.Mock).mockReturnValueOnce(updateChain);

      const result = await DoctorReviewService.replyToReview(
        'review-1',
        'doctor-1',
        'Thank you!'
      );

      expect(database.update).toHaveBeenCalled();
      expect(result).toEqual({ id: 'review-1', replyText: 'Thank you!' });
    });
  });
});
