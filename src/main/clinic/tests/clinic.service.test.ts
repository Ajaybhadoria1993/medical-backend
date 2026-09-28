import { ClinicService } from '../services/clinic.service';
import { database } from '../../../configurations/dbConnection';

jest.mock('../../../configurations/dbConnection');
jest.mock('../../../utils/logger');
jest.mock('../../../configurations/redisConfig', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    setex: jest.fn(),
    del: jest.fn(),
  },
}));

describe('ClinicService.setDoctorOnlineBooking', () => {
  const createChain = (finalValue: any) => {
    const chain: any = {};
    const methods = ['from', 'where', 'limit', 'select', 'set', 'returning'];
    methods.forEach((method) => {
      chain[method] = jest.fn().mockImplementation(() => chain);
    });
    chain.then = (resolve: any) => resolve(finalValue);
    return chain;
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('allows Admin to toggle any doctor in their clinic', async () => {
    const mockAssignment = [{ id: 'assign-1' }];
    const mockUpdated = [{ id: 'assign-1', onlineBookingEnabled: true }];
    (database.select as jest.Mock).mockReturnValueOnce(
      createChain(mockAssignment)
    );
    (database.update as jest.Mock).mockReturnValueOnce(
      createChain(mockUpdated)
    );

    const result = await ClinicService.setDoctorOnlineBooking(
      { id: 'admin-1', userType: 'Admin' },
      'clinic-1',
      'doctor-1',
      { enabled: true }
    );

    expect(result).toEqual(mockUpdated[0]);
  });

  it('allows a Doctor to toggle their own online booking setting', async () => {
    const mockAssignment = [{ id: 'assign-1' }];
    const mockUpdated = [{ id: 'assign-1', onlineBookingEnabled: false }];
    (database.select as jest.Mock).mockReturnValueOnce(
      createChain(mockAssignment)
    );
    (database.update as jest.Mock).mockReturnValueOnce(
      createChain(mockUpdated)
    );

    const result = await ClinicService.setDoctorOnlineBooking(
      { id: 'doctor-1', userType: 'Doctor' },
      'clinic-1',
      'doctor-1',
      { enabled: false }
    );

    expect(result).toEqual(mockUpdated[0]);
  });

  it("rejects a Doctor attempting to toggle another doctor's setting", async () => {
    await expect(
      ClinicService.setDoctorOnlineBooking(
        { id: 'doctor-1', userType: 'Doctor' },
        'clinic-1',
        'doctor-2',
        { enabled: true }
      )
    ).rejects.toThrow(
      'Doctors can only manage their own online booking setting.'
    );
  });

  it('returns 404 when the doctor is not assigned to the clinic', async () => {
    (database.select as jest.Mock).mockReturnValueOnce(createChain([]));

    await expect(
      ClinicService.setDoctorOnlineBooking(
        { id: 'admin-1', userType: 'Admin' },
        'clinic-1',
        'doctor-1',
        { enabled: true }
      )
    ).rejects.toThrow('Doctor not found in this clinic.');
  });

  it('rejects users who are neither Admin nor Doctor', async () => {
    await expect(
      ClinicService.setDoctorOnlineBooking(
        { id: 'receptionist-1', userType: 'Receptionist' },
        'clinic-1',
        'doctor-1',
        { enabled: true }
      )
    ).rejects.toThrow('You are not allowed to change this setting.');
  });
});
