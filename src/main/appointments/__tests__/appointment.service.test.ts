import { AppointmentService } from '../services/appointment.service';
import { database } from '../../../configurations/dbConnection';

jest.mock('../../../configurations/dbConnection');
jest.mock('../services/paymentReservation.service', () => ({
  PaymentReservationService: {
    getActiveLocksForDate: jest.fn().mockResolvedValue([]),
    filterExpiredPendingAppointments: jest
      .fn()
      .mockImplementation(async (arr) => arr),
  },
}));

describe('AppointmentService past slots tests', () => {
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

  describe('getAvailableSlotsForDate time filtering', () => {
    it('should filter out non-token slots that start in the past for today', async () => {
      const now = new Date();
      const istDateParts = now
        .toLocaleDateString('en-GB', {
          timeZone: 'Asia/Kolkata',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        })
        .split('/');
      const todayStr = `${istDateParts[2]}-${istDateParts[1]}-${istDateParts[0]}`;

      // Mock transaction queries:
      // 1. tokenAvailRows
      // 2. dateUnavailable
      // 3. dateAvail
      // 4. availRows
      // 5. breaks
      // 6. appointments
      (database.transaction as jest.Mock).mockImplementation(
        async (callback) => {
          const tx = {
            select: jest
              .fn()
              .mockReturnValueOnce(createChain([])) // 1. tokenAvailRows
              .mockReturnValueOnce(createChain([])) // 2. dateUnavailable
              .mockReturnValueOnce(createChain([])) // 3. dateAvail
              .mockReturnValueOnce(
                createChain([
                  {
                    id: 'avail-1',
                    startTime: '09:00',
                    endTime: '10:00',
                    slotMinutes: 30,
                    noOfPatients: 0,
                    isAvailable: true,
                  },
                ])
              ) // 4. availRows
              .mockReturnValueOnce(createChain([])) // 5. breaks
              .mockReturnValueOnce(createChain([])), // 6. appointments
          };
          return callback(tx);
        }
      );

      // Let's pass 09:15 as the current time
      const result = await AppointmentService.getAvailableSlotsForDate(
        'clinic-1',
        {
          date: todayStr,
          time: '09:15',
        },
        { doctorId: 'doctor-1' }
      );

      // Total slots generated from 09:00 to 10:00:
      // - 09:00 to 09:30 (starts before 09:15, should be filtered out)
      // - 09:30 to 10:00 (starts after 09:15, should be kept)
      expect(result.slots.length).toBe(1);
      expect(result.slots[0].start).toBe(`${todayStr}T09:30:00`);
    });

    it('should exclude token slots if today shift has already ended', async () => {
      const now = new Date();
      const istDateParts = now
        .toLocaleDateString('en-GB', {
          timeZone: 'Asia/Kolkata',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        })
        .split('/');
      const todayStr = `${istDateParts[2]}-${istDateParts[1]}-${istDateParts[0]}`;

      // Mock transaction queries:
      // 1. tokenAvailRows
      // 2. dateUnavailable
      // 3. booked (empty)
      // 4. breaks (empty)
      (database.transaction as jest.Mock).mockImplementation(
        async (callback) => {
          const tx = {
            select: jest
              .fn()
              .mockReturnValueOnce(
                createChain([
                  {
                    id: 'avail-2',
                    startTime: '09:00',
                    endTime: '13:00',
                    noOfPatients: 10,
                    isAvailable: true,
                  },
                ])
              ) // 1. tokenAvailRows
              .mockReturnValueOnce(createChain([])) // 2. dateUnavailable
              .mockReturnValueOnce(createChain([])) // 3. booked
              .mockReturnValueOnce(createChain([])) // 4. breaks
              // The response is now built per shift, so the day is resolved
              // into its blocks: no date-specific row, then the weekly row and
              // its breaks. One 09:00-13:00 block, so a single session.
              .mockReturnValueOnce(createChain([])) // 5. clinic_date_availability
              .mockReturnValueOnce(
                createChain([
                  {
                    id: 'avail-2',
                    startTime: '09:00',
                    endTime: '13:00',
                    noOfPatients: 10,
                    isAvailable: true,
                  },
                ])
              ) // 6. weekly row
              .mockReturnValueOnce(createChain([])) // 7. no breaks
              // Then that session's capacity: no override, so the weekly
              // number applies.
              .mockReturnValueOnce(createChain([])) // 8. no slot_config override
              .mockReturnValueOnce(createChain([{ noOfPatients: 10 }])), // 9. weekly capacity
          };
          return callback(tx);
        }
      );

      // Pass 14:00 as the current time (shift ended at 13:00)
      const result = await AppointmentService.getAvailableSlotsForDate(
        'clinic-1',
        {
          date: todayStr,
          time: '14:00',
        },
        { doctorId: 'doctor-1' }
      );

      expect(result.slots.length).toBe(0);
    });

    it('should include token slots if future shift date is queried even if current time is past the shift end time', async () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const istDatePartsTomorrow = tomorrow
        .toLocaleDateString('en-GB', {
          timeZone: 'Asia/Kolkata',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        })
        .split('/');
      const tomorrowStr = `${istDatePartsTomorrow[2]}-${istDatePartsTomorrow[1]}-${istDatePartsTomorrow[0]}`;

      // Mock transaction queries:
      // 1. tokenAvailRows
      // 2. dateUnavailable
      // 3. booked (empty)
      // 4. breaks (empty)
      (database.transaction as jest.Mock).mockImplementation(
        async (callback) => {
          const tx = {
            select: jest
              .fn()
              .mockReturnValueOnce(
                createChain([
                  {
                    id: 'avail-3',
                    startTime: '09:00',
                    endTime: '13:00',
                    noOfPatients: 10,
                    isAvailable: true,
                  },
                ])
              ) // 1. tokenAvailRows
              .mockReturnValueOnce(createChain([])) // 2. dateUnavailable
              .mockReturnValueOnce(createChain([])) // 3. booked
              .mockReturnValueOnce(createChain([])) // 4. breaks
              // Per-shift resolution, as above: one 09:00-13:00 session.
              .mockReturnValueOnce(createChain([])) // 5. clinic_date_availability
              .mockReturnValueOnce(
                createChain([
                  {
                    id: 'avail-3',
                    startTime: '09:00',
                    endTime: '13:00',
                    noOfPatients: 10,
                    isAvailable: true,
                  },
                ])
              ) // 6. weekly row
              .mockReturnValueOnce(createChain([])) // 7. no breaks
              .mockReturnValueOnce(createChain([])) // 8. no slot_config override
              .mockReturnValueOnce(createChain([{ noOfPatients: 10 }])), // 9. weekly capacity
          };
          return callback(tx);
        }
      );

      // Pass 14:00 as the current time (shift ends at 13:00)
      const result = await AppointmentService.getAvailableSlotsForDate(
        'clinic-1',
        {
          date: tomorrowStr,
          time: '14:00',
        },
        { doctorId: 'doctor-1' }
      );

      expect(result.slots.length).toBe(1);
      expect(result.slots[0].start).toBe(`${tomorrowStr}T09:00:00`);
    });

    it('returns one entry per shift, each numbering its tokens from 1', async () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const parts = tomorrow
        .toLocaleDateString('en-GB', {
          timeZone: 'Asia/Kolkata',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        })
        .split('/');
      const tomorrowStr = `${parts[2]}-${parts[1]}-${parts[0]}`;

      // 10:00-13:00 and 17:00-21:00, carved out of one window by a break.
      const weeklyRow = {
        id: 'avail-split',
        startTime: '10:00 AM',
        endTime: '09:00 PM',
        noOfPatients: 20,
        isAvailable: true,
      };

      (database.transaction as jest.Mock).mockImplementation(
        async (callback) => {
          const tx = {
            select: jest
              .fn()
              .mockReturnValueOnce(createChain([weeklyRow])) // tokenAvailRows
              .mockReturnValueOnce(createChain([])) // dateUnavailable
              .mockReturnValueOnce(createChain([])) // booked
              .mockReturnValueOnce(createChain([])) // breaks (display)
              .mockReturnValueOnce(createChain([])) // no date-specific row
              .mockReturnValueOnce(createChain([weeklyRow])) // weekly row
              .mockReturnValueOnce(
                createChain([{ startTime: '01:00 PM', endTime: '05:00 PM' }])
              ) // the break that splits the day
              // Both sessions then resolve their capacity concurrently, so
              // their reads interleave: an override lookup (none) and the
              // weekly number, twice over in no fixed order. Answered by a
              // default rather than a queue, since a queue would depend on
              // which promise happened to run first.
              .mockImplementation(() => createChain([{ noOfPatients: 20 }])),
          };
          return callback(tx);
        }
      );

      const result = await AppointmentService.getAvailableSlotsForDate(
        'clinic-1',
        { date: tomorrowStr },
        { doctorId: 'doctor-1' }
      );

      // Two entries, not one flat list — this is what lets a caller offer the
      // choice and pass `sessionIndex` back when booking.
      expect(result.slots.length).toBe(2);
      expect(result.slots[0].sessionIndex).toBe(1);
      expect(result.slots[1].sessionIndex).toBe(2);
      expect(result.slots[0].totalSessions).toBe(2);

      // Each shift restarts at 1, so token 1 exists twice on this day.
      expect(result.slots[0].tokens?.[0].tokenNo).toBe(1);
      expect(result.slots[1].tokens?.[0].tokenNo).toBe(1);
      expect(result.slots[1].sessionStart).toBe('17:00');
    });
  });

  describe('validateAppointmentBooking past validation', () => {
    it('should allow booking a token even if today shift has already ended', async () => {
      const now = new Date();
      const istDateParts = now
        .toLocaleDateString('en-GB', {
          timeZone: 'Asia/Kolkata',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        })
        .split('/');
      const todayStr = `${istDateParts[2]}-${istDateParts[1]}-${istDateParts[0]}`;

      const doctorId = '65a8df2d-60fa-4e71-88df-b59f3dbd9821';
      const patientId = '77ce9842-88f1-4fb2-b7e1-88b1d8f583e7';

      const mockUsers = [
        { id: doctorId, status: 'Active', userType: 'Doctor' },
        { id: patientId, status: 'Active', userType: 'Patient' },
      ];

      const availabilityRow = {
        id: 'avail-1',
        startTime: '08:00',
        endTime: '09:00', // ended at 9 AM
        noOfPatients: 10,
        isAvailable: true,
      };

      const tx = {
        select: jest
          .fn()
          .mockReturnValueOnce(createChain(mockUsers)) // users check
          .mockReturnValueOnce(createChain([availabilityRow])) // availability
          // Session resolution re-reads the day to find its shifts: no
          // date-specific row, then the weekly row and its breaks. A single
          // 08:00-09:00 block, so the day has exactly one session.
          .mockReturnValueOnce(createChain([])) // no clinic_date_availability
          .mockReturnValueOnce(createChain([availabilityRow])) // weekly row
          .mockReturnValueOnce(createChain([])) // no breaks
          // Then capacity for that session: no same-day override, so it falls
          // through to the weekly row's noOfPatients.
          .mockReturnValueOnce(createChain([])) // no slot_config override
          .mockReturnValueOnce(createChain([availabilityRow])), // weekly capacity
      };

      await expect(
        AppointmentService.validateAppointmentBooking(
          patientId,
          'clinic-1',
          {
            patientId: patientId,
            doctorId: doctorId,
            appointmentDate: todayStr,
            appointmentType: 'Consultation',
          },
          patientId,
          tx
        )
      ).rejects.not.toThrow(
        // The ended-shift gate is gone: this call now runs past it and only
        // fails later, where the stubbed tx runs out of mocked queries.
        'Clinic availability shift has already ended for today'
      );
    });
  });
});
