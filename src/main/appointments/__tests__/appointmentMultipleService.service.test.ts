// Unit tests for AppointmentMultipleServiceService add-on service reads:
// the clinic check on the HTTP path and the shared listByAppointmentId query.

const selectMock = jest.fn();

jest.mock('../../../configurations/dbConnection', () => ({
  database: {
    select: (...args: unknown[]) => selectMock(...args),
  },
}));

jest.mock('../../../utils/logger');

jest.mock('../../../utils/clinicOwnership', () => ({
  isAppointmentInClinic: jest.fn(),
}));

import { HttpError } from '../../../middlewear/errorHandler';
import { isAppointmentInClinic } from '../../../utils/clinicOwnership';
import { AppointmentMultipleServiceService } from '../services/appointmentMultipleService.service';

type Call = { method: string; args: any[] };

const APPOINTMENT = 'appt-1';
const CLINIC = 'clinic-1';

/** Chainable query stub: records every call and resolves to `rows` when awaited. */
const queryReturning = (rows: unknown) => {
  const calls: Call[] = [];
  const chain: any = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'then') {
          return (resolve: (value: unknown) => unknown) => resolve(rows);
        }
        if (prop === 'calls') return calls;
        return (...args: any[]) => {
          calls.push({ method: String(prop), args });
          return chain;
        };
      },
    }
  );
  return chain;
};

const argsOf = (chain: any, method: string) =>
  (chain.calls as Call[]).filter((c) => c.method === method).map((c) => c.args);

/** True when a Drizzle condition tree binds `needle` as a value. */
const bindsValue = (node: any, needle: unknown, depth = 0): boolean => {
  if (depth > 10 || node == null) return false;
  if (node === needle) return true;
  if (Array.isArray(node)) {
    return node.some((item) => bindsValue(item, needle, depth + 1));
  }
  if (typeof node !== 'object') return false;
  return ['value', 'queryChunks', 'left', 'right', 'conditions'].some((key) =>
    bindsValue(node[key], needle, depth + 1)
  );
};

const serviceRows = [
  {
    id: 'ams-1',
    appointmentId: APPOINTMENT,
    serviceId: 'svc-2',
    price: 200,
    serviceName: 'Dressing',
    currency: 'INR',
    durationDays: 0,
  },
];

describe('AppointmentMultipleServiceService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    selectMock.mockReset();
  });

  describe('getMultipleServicesByAppointmentId', () => {
    it('returns 404 without querying when the appointment is not in the clinic', async () => {
      (isAppointmentInClinic as jest.Mock).mockResolvedValue(false);

      const error =
        (await AppointmentMultipleServiceService.getMultipleServicesByAppointmentId(
          APPOINTMENT,
          CLINIC
        ).catch((e: unknown) => e as HttpError)) as HttpError;

      expect(error).toBeInstanceOf(HttpError);
      expect(error.message).toBe('Appointment not found');
      expect(isAppointmentInClinic).toHaveBeenCalledWith(APPOINTMENT, CLINIC);
      expect(selectMock).not.toHaveBeenCalled();
    });

    it('returns the add-on services when the appointment is in the clinic', async () => {
      (isAppointmentInClinic as jest.Mock).mockResolvedValue(true);
      selectMock.mockReturnValueOnce(queryReturning(serviceRows));

      const result =
        await AppointmentMultipleServiceService.getMultipleServicesByAppointmentId(
          APPOINTMENT,
          CLINIC
        );

      expect(result).toEqual(serviceRows);
    });
  });

  describe('listByAppointmentId', () => {
    it('filters by appointment and joins the service name', async () => {
      const query = queryReturning(serviceRows);
      selectMock.mockReturnValueOnce(query);

      const result =
        await AppointmentMultipleServiceService.listByAppointmentId(
          APPOINTMENT
        );

      expect(result).toEqual(serviceRows);
      expect(bindsValue(argsOf(query, 'where'), APPOINTMENT)).toBe(true);
      expect(argsOf(query, 'leftJoin')).toHaveLength(1);
      expect(Object.keys(selectMock.mock.calls[0][0])).toEqual(
        expect.arrayContaining([
          'serviceName',
          'currency',
          'durationDays',
          'price',
        ])
      );
    });
  });
});
