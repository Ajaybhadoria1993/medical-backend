/**
 * Who may change a doctor's consultation length, and what a null clears.
 *
 * The permission rule is the reason this exists: without it one doctor could
 * set another's, and nothing else in the stack checks it.
 */

import { database } from '../../../configurations/dbConnection';
import { ConsultationDurationService } from '../../appointment-engine/services/consultationDuration.service';
import { AppointmentEngineOrchestrator } from '../../appointment-engine/services/orchestrator.service';
import { ClinicService } from '../services/clinic.service';

const ADMIN = { id: 'admin-1', userType: 'Admin' };
const DOCTOR = { id: 'doctor-1', userType: 'Doctor' };

/** A drizzle builder that resolves to `value` however it is chained. */
const chain = (value: unknown) => {
  const c: Record<string, unknown> = {};
  for (const m of ['from', 'where', 'limit', 'set', 'returning']) {
    c[m] = jest.fn(() => c);
  }
  c.then = (resolve: (v: unknown) => unknown) => resolve(value);
  return c;
};

/** Captures the values the update would have written. */
let written: Record<string, unknown> | null = null;
let invalidate: jest.SpyInstance;

const mockAssignment = (found: boolean) => {
  (database.select as jest.Mock).mockReturnValue(
    chain(found ? [{ id: 'assign-1' }] : [])
  );
  (database.update as jest.Mock).mockReturnValue({
    set: (values: Record<string, unknown>) => {
      written = values;
      return chain([
        { defaultConsultationMinutes: values.defaultConsultationMinutes },
      ]);
    },
  });
};

beforeEach(() => {
  written = null;
  jest.clearAllMocks();
  invalidate = jest
    .spyOn(ConsultationDurationService, 'invalidate')
    .mockResolvedValue();
  // Fire-and-forget in the service; stubbed so no real recalculation runs.
  jest
    .spyOn(AppointmentEngineOrchestrator.prototype, 'onSessionOverride')
    .mockResolvedValue();
});

describe('ClinicService.setDoctorConsultationDuration', () => {
  it('refuses a doctor changing someone else', async () => {
    mockAssignment(true);

    await expect(
      ClinicService.setDoctorConsultationDuration(
        DOCTOR,
        'clinic-1',
        'doctor-2',
        20
      )
    ).rejects.toMatchObject({ status: 403 });

    expect(written).toBeNull();
  });

  it('lets a doctor change their own', async () => {
    mockAssignment(true);

    await ClinicService.setDoctorConsultationDuration(
      DOCTOR,
      'clinic-1',
      DOCTOR.id,
      20
    );

    expect(written).toMatchObject({ defaultConsultationMinutes: 20 });
  });

  it('lets an admin change any doctor', async () => {
    mockAssignment(true);

    await ClinicService.setDoctorConsultationDuration(
      ADMIN,
      'clinic-1',
      'doctor-2',
      15
    );

    expect(written).toMatchObject({ defaultConsultationMinutes: 15 });
  });

  it('refuses a role that is neither admin nor doctor', async () => {
    mockAssignment(true);

    await expect(
      ClinicService.setDoctorConsultationDuration(
        { id: 'r-1', userType: 'Receptionist' },
        'clinic-1',
        'doctor-1',
        20
      )
    ).rejects.toMatchObject({ status: 403 });

    expect(written).toBeNull();
  });

  it('clears the value back to automatic', async () => {
    mockAssignment(true);

    await ClinicService.setDoctorConsultationDuration(
      ADMIN,
      'clinic-1',
      'doctor-1',
      null
    );

    expect(written).toMatchObject({ defaultConsultationMinutes: null });
  });

  /**
   * The engine caches its answer for ten minutes, so without this the doctor
   * picks 10 and the timeline keeps spacing tokens by the old figure.
   */
  it('clears the cached figure so the engine stops quoting the old one', async () => {
    mockAssignment(true);

    await ClinicService.setDoctorConsultationDuration(
      ADMIN,
      'clinic-1',
      'doctor-2',
      15
    );

    expect(invalidate).toHaveBeenCalledWith('doctor-2');
  });

  it('leaves the cache alone when the change was refused', async () => {
    mockAssignment(true);

    await expect(
      ClinicService.setDoctorConsultationDuration(
        DOCTOR,
        'clinic-1',
        'doctor-2',
        20
      )
    ).rejects.toMatchObject({ status: 403 });

    expect(invalidate).not.toHaveBeenCalled();
  });

  it('404s when the doctor is not assigned to this clinic', async () => {
    mockAssignment(false);

    await expect(
      ClinicService.setDoctorConsultationDuration(
        ADMIN,
        'clinic-1',
        'doctor-9',
        20
      )
    ).rejects.toMatchObject({ status: 404 });

    expect(written).toBeNull();
  });
});
