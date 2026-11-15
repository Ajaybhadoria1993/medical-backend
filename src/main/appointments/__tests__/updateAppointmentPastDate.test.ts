import { AppointmentService } from '../services/appointment.service';
import { database } from '../../../configurations/dbConnection';
import { getISTDateString } from '../../../utils/istDateTime';

jest.mock('../../../configurations/dbConnection');

// Date rules on edit: never into the past, Confirm/Arrived only today, and one stored date shape.
const REACHED_WRITE = new Error('reached the update write');
const DAY = 24 * 60 * 60 * 1000;
const istDay = (offsetDays: number) =>
  getISTDateString(new Date(Date.now() + offsetDays * DAY));

const chain = (rows: unknown[]) => {
  const c: any = {};
  ['from', 'leftJoin', 'innerJoin', 'where', 'limit'].forEach((m) => {
    c[m] = jest.fn(() => c);
  });
  c.then = (resolve: any, reject: any) =>
    Promise.resolve(rows).then(resolve, reject);
  return c;
};

let written: Record<string, unknown> | undefined;

const editFrom = (
  storedDate: string,
  payload: object,
  performer: [string, string] = ['admin-1', 'Admin']
) => {
  written = undefined;
  (database.transaction as jest.Mock).mockImplementation(async (cb) =>
    cb({
      select: jest
        .fn()
        .mockReturnValueOnce(
          chain([
            {
              id: 'appt-1',
              doctorId: 'doctor-a',
              clinicId: 'clinic-1',
              appointmentStatus: 'Upcoming',
              appointmentDate: new Date(storedDate),
              tokenNo: null,
            },
          ])
        )
        .mockReturnValue(chain([])),
      update: jest.fn(() => ({
        set: (values: Record<string, unknown>) => {
          written = values;
          throw REACHED_WRITE;
        },
      })),
    })
  );
  return AppointmentService.updateAppointment(
    'appt-1',
    payload as any,
    ...performer
  );
};

describe('updateAppointment — past dates', () => {
  it('refuses moving an appointment to yesterday', async () => {
    await expect(
      editFrom(istDay(2), { appointmentDate: istDay(-1) })
    ).rejects.toMatchObject({
      status: 400,
      message: 'Appointment date cannot be in the past',
    });
  });

  it('allows moving an appointment to today', async () => {
    await expect(
      editFrom(istDay(2), { appointmentDate: istDay(0) })
    ).rejects.toBe(REACHED_WRITE);
  });

  it('still saves an edit that resends a past visit’s own date', async () => {
    await expect(
      editFrom(istDay(-3), { appointmentDate: istDay(-3), price: '500' })
    ).rejects.toBe(REACHED_WRITE);
  });
});

describe('updateAppointment — Confirm/Arrived only today', () => {
  it('refuses confirming an appointment dated tomorrow', async () => {
    await expect(
      editFrom(istDay(1), { appointmentStatus: 'Confirmed' }, [
        'doctor-a',
        'Doctor',
      ])
    ).rejects.toMatchObject({ status: 409 });
  });

  it('refuses marking arrived on a past-dated appointment', async () => {
    await expect(
      editFrom(istDay(-1), { appointmentStatus: 'Patient Arrived' }, [
        'rec-1',
        'Receptionist',
      ])
    ).rejects.toMatchObject({ status: 409 });
  });

  it('allows confirming an appointment dated today', async () => {
    await expect(
      editFrom(istDay(0), { appointmentStatus: 'Confirmed' }, [
        'doctor-a',
        'Doctor',
      ])
    ).rejects.toBe(REACHED_WRITE);
  });
});

describe('updateAppointment — one stored date shape', () => {
  it('stores a reschedule date+time instant as the IST day at midnight', async () => {
    const day = istDay(2);
    // 23:59 IST on that day, as the Reschedule screen sends it.
    const instant = new Date(`${day}T23:59:00+05:30`).toISOString();
    await expect(
      editFrom(istDay(1), { appointmentDate: instant })
    ).rejects.toBe(REACHED_WRITE);
    expect(written?.appointmentDate).toEqual(new Date(day));
  });
});
