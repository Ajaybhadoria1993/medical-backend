import { AppointmentService } from '../services/appointment.service';
import { ReportCardService } from '../../reports/services/reportCard.service';
import { database } from '../../../configurations/dbConnection';

jest.mock('../../../configurations/dbConnection');

// Confirm, complete and prescribe belong to the appointment's own doctor only.
const PASSED_GUARD = new Error('passed the ownership guard');

const chain = (rows: unknown[]) => {
  const c: any = {};
  ['from', 'leftJoin', 'innerJoin', 'where', 'limit'].forEach((m) => {
    c[m] = jest.fn(() => c);
  });
  c.then = (resolve: any, reject: any) =>
    Promise.resolve(rows).then(resolve, reject);
  return c;
};

const appointment = {
  id: 'appt-1',
  doctorId: 'doctor-a',
  clinicId: 'clinic-1',
  appointmentStatus: 'Patient Arrived',
};

// First select returns the appointment; the next one throws so a passing call stops right after the guard.
const mockTransaction = (row: object) => {
  (database.transaction as jest.Mock).mockImplementation(async (cb) =>
    cb({
      select: jest
        .fn()
        .mockReturnValueOnce(chain([row]))
        .mockImplementation(() => {
          throw PASSED_GUARD;
        }),
    })
  );
};

const update = (status: string, userId: string, userType: string) =>
  AppointmentService.updateAppointment(
    'appt-1',
    { appointmentStatus: status } as any,
    userId,
    userType
  );

describe('updateAppointment — confirm/complete ownership', () => {
  beforeEach(() => mockTransaction(appointment));

  it.each([
    ['Doctor', 'Confirmed'],
    ['Doctor', 'Completed'],
    ['Admin', 'Confirmed'],
    ['Admin', 'Completed'],
  ])(
    'blocks %s confirming/completing another doctor (%s)',
    async (role, status) => {
      await expect(update(status, 'someone-else', role)).rejects.toMatchObject({
        status: 403,
      });
    }
  );

  it('lets the own doctor confirm', async () => {
    await expect(update('Confirmed', 'doctor-a', 'Doctor')).rejects.toBe(
      PASSED_GUARD
    );
  });

  it('lets an admin-doctor complete their own appointment', async () => {
    await expect(update('Completed', 'doctor-a', 'Admin')).rejects.toBe(
      PASSED_GUARD
    );
  });

  it('leaves reception on its existing assignment scope', async () => {
    await expect(
      update('Completed', 'reception-1', 'Receptionist')
    ).rejects.toBe(PASSED_GUARD);
  });

  it('ignores an unchanged status, so admin payment edits still save', async () => {
    mockTransaction({ ...appointment, appointmentStatus: 'Confirmed' });
    await expect(update('Confirmed', 'admin-1', 'Admin')).rejects.toBe(
      PASSED_GUARD
    );
  });
});

describe('createPatientReportCard — prescriber ownership', () => {
  const create = (userId: string, clinicId: string) =>
    ReportCardService.createPatientReportCard(
      {
        reportCard: { appointmentId: 'appt-1', petientId: 'patient-1' },
        prescriptions: [],
      } as any,
      userId,
      clinicId
    );

  beforeEach(() => {
    (database.transaction as jest.Mock).mockImplementation(async (cb) =>
      cb({
        select: jest
          .fn()
          .mockReturnValueOnce(chain([appointment]))
          .mockReturnValueOnce(chain([]))
          .mockImplementation(() => {
            throw PASSED_GUARD;
          }),
        insert: jest.fn(() => {
          throw PASSED_GUARD;
        }),
      })
    );
  });

  it('blocks another doctor or an admin from prescribing', async () => {
    await expect(create('doctor-b', 'clinic-1')).rejects.toMatchObject({
      status: 403,
    });
  });

  it("treats another clinic's appointment as not found", async () => {
    await expect(create('doctor-a', 'clinic-2')).rejects.toMatchObject({
      status: 404,
    });
  });

  it('lets the own doctor prescribe', async () => {
    await expect(create('doctor-a', 'clinic-1')).rejects.toBe(PASSED_GUARD);
  });

  it('refuses even the own doctor once the appointment day has passed', async () => {
    const yesterday = {
      ...appointment,
      appointmentDate: new Date(Date.now() - 86_400_000 * 2),
    };
    (database.transaction as jest.Mock).mockImplementation(async (cb) =>
      cb({
        select: jest
          .fn()
          .mockReturnValueOnce(chain([yesterday]))
          .mockReturnValueOnce(chain([]))
          .mockReturnValueOnce(chain([yesterday])),
      })
    );
    await expect(create('doctor-a', 'clinic-1')).rejects.toMatchObject({
      status: 409,
    });
  });
});
