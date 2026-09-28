import { PharmacyService } from '../services/pharmacy.service';
import { LabService } from '../../lab/services/lab.service';
import { database } from '../../../configurations/dbConnection';
import { sendEmail } from '../../../utils/email';

// Mock email dependency explicitly for this test
jest.mock('../../../utils/email', () => ({
  sendEmail: jest.fn().mockResolvedValue({}),
}));

describe('Lab and Pharmacy Creation Email Sending Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createPharmacy Email', () => {
    it('should trigger sendEmail with correct values when pharmacy is created', async () => {
      const mockPharmacy = {
        id: 'pharmacy-123',
        name: 'Test Pharmacy',
        address: '123 Pharmacy Lane',
        contactNumber: '1234567890',
        clinicId: 'clinic-123',
      };

      const mockClinic = {
        id: 'clinic-123',
        clinicName: 'Test Clinic',
      };

      const mockAdminUser = {
        id: 'admin-123',
        name: 'Dr. John Doe',
        email: 'admin@example.com',
      };

      // Mock transaction query calls
      const mockTx = {
        select: jest.fn().mockReturnThis(),
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([]),
        insert: jest.fn().mockReturnThis(),
        values: jest.fn().mockReturnThis(),
        returning: jest.fn().mockResolvedValue([mockPharmacy]),
      };

      (database.transaction as jest.Mock).mockImplementation(async (cb) => {
        return await cb(mockTx);
      });

      // Mock subsequent select queries for clinic and admin user
      let selectCount = 0;
      (database.select as jest.Mock).mockImplementation(() => {
        return {
          from: jest.fn().mockImplementation(() => {
            return {
              where: jest.fn().mockImplementation(() => {
                return {
                  limit: jest.fn().mockImplementation(async () => {
                    selectCount++;
                    if (selectCount === 1) {
                      return [mockClinic];
                    }
                    return [mockAdminUser];
                  }),
                };
              }),
            };
          }),
        };
      });

      // Call createPharmacy
      const result = await PharmacyService.createPharmacy(
        {
          name: 'Test Pharmacy',
          address: '123 Pharmacy Lane',
          contactNumber: '1234567890',
        },
        'clinic-123',
        'admin-123'
      );

      expect(result).toBeDefined();

      // Wait a moment for setImmediate async sendEmail callback to execute
      await new Promise((resolve) => setImmediate(resolve));

      // Verify that sendEmail was called
      expect(sendEmail).toHaveBeenCalledTimes(1);
      expect(sendEmail).toHaveBeenCalledWith(
        'admin@example.com',
        expect.stringContaining('Pharmacy Created: Test Pharmacy'),
        expect.stringContaining('Dear Dr. John Doe')
      );
    });
  });

  describe('createLab Email', () => {
    it('should trigger sendEmail with correct values when lab is created', async () => {
      const mockLab = {
        id: 'lab-123',
        name: 'Test Lab',
        address: '123 Lab St',
        contactNo: '9876543210',
        email: 'lab@example.com',
        clinicId: 'clinic-123',
      };

      const mockClinic = {
        id: 'clinic-123',
        clinicName: 'Test Clinic',
      };

      const mockAdminUser = {
        id: 'admin-123',
        name: 'Dr. John Doe',
        email: 'admin@example.com',
      };

      const mockTx = {
        select: jest.fn().mockReturnThis(),
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([]),
        insert: jest.fn().mockReturnThis(),
        values: jest.fn().mockReturnThis(),
        returning: jest.fn().mockResolvedValue([mockLab]),
      };

      (database.transaction as jest.Mock).mockImplementation(async (cb) => {
        return await cb(mockTx);
      });

      let selectCount = 0;
      (database.select as jest.Mock).mockImplementation(() => {
        return {
          from: jest.fn().mockImplementation(() => {
            return {
              where: jest.fn().mockImplementation(() => {
                return {
                  limit: jest.fn().mockImplementation(async () => {
                    selectCount++;
                    if (selectCount === 1) {
                      return [mockClinic];
                    }
                    return [mockAdminUser];
                  }),
                };
              }),
            };
          }),
        };
      });

      // Call createLab
      const result = await LabService.createLab(
        {
          name: 'Test Lab',
          address: '123 Lab St',
          contactNo: '9876543210',
          email: 'lab@example.com',
        },
        'clinic-123',
        'admin-123'
      );

      expect(result).toBeDefined();

      // Wait a moment for setImmediate async sendEmail callback to execute
      await new Promise((resolve) => setImmediate(resolve));

      // Verify that sendEmail was called
      expect(sendEmail).toHaveBeenCalledTimes(1);
      expect(sendEmail).toHaveBeenCalledWith(
        'admin@example.com',
        expect.stringContaining('Lab Created: Test Lab'),
        expect.stringContaining('Dear Dr. John Doe')
      );
    });
  });
});
