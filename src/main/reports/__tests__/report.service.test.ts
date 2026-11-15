import { database } from '../../../configurations/dbConnection';
import { ReportCardService } from '../services/reportCard.service';
import { PrescriptionPrintService } from '../services/prescriptionPrint.service';
import { ReportHistoryService } from '../services/reportHistory.service';
import { ReportService } from '../services/report.service';
import { HttpError } from '../../../middlewear/errorHandler';
import { PrescriptionNotificationService } from '../../notifications/services/prescriptionNotification.service';

// Mock dependencies
jest.mock('../../../configurations/dbConnection');
jest.mock('../../../utils/logger');

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

describe('ReportService Clinic Isolation Unit Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  /** Like `createChain`, but keeps the call args so a test can assert the
   *  clinic filter actually reached the query. */
  const createRecordingChain = (finalValue: any) => {
    const calls: { method: string; args: any[] }[] = [];
    const chain: any = new Proxy(
      {},
      {
        get(target, prop) {
          if (prop === 'then') {
            return (resolve: any) => resolve(finalValue);
          }
          if (prop === '__calls') return calls;
          return (...args: any[]) => {
            calls.push({ method: String(prop), args });
            return chain;
          };
        },
      }
    );
    return chain;
  };

  // Dynamic chain builder using ES6 Proxy to avoid hardcoded chain method lists
  const createChain = (finalValue: any) => {
    const chain: any = new Proxy(
      {},
      {
        get(target, prop) {
          if (prop === 'then') {
            return (resolve: any) => resolve(finalValue);
          }
          return () => chain;
        },
      }
    );
    return chain;
  };

  describe('getReportCard', () => {
    it('should query report card restricting by clinicId', async () => {
      const mockReportCard = [
        { id: 'rc-1', appointmentId: 'app-1', clinicId: 'clinic-1' },
      ];
      const mockPrescriptions: any[] = [];
      const mockClinic = [{ id: 'clinic-1', clinicName: 'Test Clinic' }];

      const selectChain = createRecordingChain(mockReportCard);
      const prescriptionsChain = createChain(mockPrescriptions);
      const clinicChain = createChain(mockClinic);

      (database.transaction as jest.Mock).mockImplementation(
        async (callback) => {
          // Only the first three matter here; the default catches the rest so
          // a new query in the service cannot break this test.
          const tx = {
            select: jest
              .fn()
              .mockReturnValueOnce(selectChain) // First query: reportCardResult
              .mockReturnValueOnce(prescriptionsChain) // Second query: prescriptions
              .mockReturnValueOnce(clinicChain) // Third query: clinicResult
              .mockReturnValue(createChain([])), // Anything else this call makes
          };
          return callback(tx);
        }
      );

      const result = await ReportHistoryService.getReportCard(
        { appointmentId: 'app-1' },
        'clinic-1'
      );
      expect(result).toHaveProperty('reportCard');
      expect(result).toHaveProperty('clinic');

      // The point of the test: asserting the result shape alone still passed
      // with the clinic filter deleted.
      const whereCall = (
        selectChain.__calls as { method: string; args: any[] }[]
      ).find((call) => call.method === 'where');

      expect(whereCall).toBeDefined();

      const containsValue = (node: any, needle: string, depth = 0): boolean => {
        if (depth > 8 || node == null) return false;
        if (typeof node === 'string') return node === needle;
        if (Array.isArray(node))
          return node.some((item) => containsValue(item, needle, depth + 1));
        if (typeof node !== 'object') return false;

        // Only follow the parts of a Drizzle condition that carry values;
        // `table` and `column` loop back on themselves.
        return ['value', 'queryChunks', 'left', 'right', 'conditions'].some(
          (key) => containsValue((node as any)[key], needle, depth + 1)
        );
      };

      expect(containsValue(whereCall?.args, 'clinic-1')).toBe(true);
    });
  });

  describe('getReportCard tests list and clinic fields', () => {
    /** One recorded query per tx.select() call, in call order. */
    const mockTransaction = (results: unknown[]) => {
      const chains = results.map((rows) => createRecordingChain(rows));
      const select = jest.fn();
      chains.forEach((chain) => select.mockReturnValueOnce(chain));
      select.mockReturnValue(createChain([]));
      (database.transaction as jest.Mock).mockImplementation(async (callback) =>
        callback({ select })
      );
      return { chains, select };
    };

    const whereArgsOf = (chain: any) =>
      (chain.__calls as { method: string; args: any[] }[]).find(
        (call) => call.method === 'where'
      )?.args;

    const tests = [
      { id: 'test-1', name: 'CBC' },
      { id: 'test-2', name: 'Lipid Profile' },
    ];

    it('returns the tests ordered for the appointment, scoped to the clinic', async () => {
      // report card, prescriptions, pharmacy, clinic, tests
      const { chains } = mockTransaction([
        [{ id: 'rc-1', appointmentId: 'app-1' }],
        [],
        [],
        [{ id: 'clinic-1', clinicName: 'Test Clinic' }],
        tests,
      ]);

      const result = await ReportHistoryService.getReportCard(
        { appointmentId: 'app-1' },
        'clinic-1'
      );

      expect(result.tests).toEqual(tests);
      const where = whereArgsOf(chains[4]);
      expect(bindsValue(where, 'app-1')).toBe(true);
      expect(bindsValue(where, 'clinic-1')).toBe(true);
    });

    it('still returns the tests when the visit has no report card yet', async () => {
      // report card, appointment, last report card, pharmacy, clinic, tests
      const { chains } = mockTransaction([
        [],
        [{ patientId: 'pat-1' }],
        [],
        [],
        [{ id: 'clinic-1' }],
        tests,
      ]);

      const result = await ReportHistoryService.getReportCard(
        { appointmentId: 'app-1' },
        'clinic-1'
      );

      expect(result.tests).toEqual(tests);
      expect(bindsValue(whereArgsOf(chains[5]), 'clinic-1')).toBe(true);
    });

    it('returns no tests and skips the query without an appointment id', async () => {
      // report card, pharmacy, clinic
      const { select } = mockTransaction([[], [], [{ id: 'clinic-1' }]]);

      const result = await ReportHistoryService.getReportCard(
        { reportCardId: 'rc-9' },
        'clinic-1'
      );

      expect(result.tests).toEqual([]);
      expect(select).toHaveBeenCalledTimes(3);
    });

    it('selects only the clinic fields screens use', async () => {
      const { select } = mockTransaction([
        [{ id: 'rc-1', appointmentId: 'app-1' }],
        [],
        [],
        [{ id: 'clinic-1' }],
        [],
      ]);

      await ReportHistoryService.getReportCard(
        { appointmentId: 'app-1' },
        'clinic-1'
      );

      // report card, prescriptions, pharmacy, then the clinic query
      expect(Object.keys(select.mock.calls[3][0]).sort()).toEqual(
        [
          'City',
          'State',
          'Tagline',
          'ZipCode',
          'clinicAddress',
          'clinicLocation',
          'clinicLogo',
          'clinicName',
          'clinicPhone',
          'id',
        ].sort()
      );
    });
  });

  describe('getALlReport', () => {
    it('should query reports using clinicAssign check', async () => {
      const mockReports = [{ id: 'r-1', petientId: 'pat-1' }];
      const selectChain = createChain(mockReports);

      (database.select as jest.Mock).mockReturnValue(selectChain);

      const result = await ReportService.getALlReport('pat-1', 'clinic-1');
      expect(result).toEqual(mockReports);
    });
  });

  describe('getReport', () => {
    it('should retrieve report with clinic scoping', async () => {
      const mockReport = [{ id: 'r-1', petientId: 'pat-1' }];
      const selectChain = createChain(mockReport);

      (database.select as jest.Mock).mockReturnValue(selectChain);

      const result = await ReportService.getReport('r-1', 'clinic-1');
      expect(result).toEqual(mockReport);
    });
  });

  describe('getFavouritePrescription', () => {
    it('should throw 403 if doctor is not assigned to the clinic', async () => {
      const mockAssignment: any[] = []; // Empty => not assigned
      const selectChain = createChain(mockAssignment);

      (database.select as jest.Mock).mockReturnValue(selectChain);

      await expect(
        ReportCardService.getFavouritePrescription('doc-1', 'clinic-1')
      ).rejects.toThrow(
        new HttpError(
          403,
          'Access denied. Doctor is not assigned to this clinic.'
        )
      );
    });

    it('should return favourites if doctor is assigned to the clinic', async () => {
      const mockAssignment = [{ id: 'assign-1' }];
      const mockFavourites = [{ id: 'fav-1', doctorId: 'doc-1' }];

      const assignChain = createChain(mockAssignment);
      const favChain = createChain(mockFavourites);

      (database.select as jest.Mock)
        .mockReturnValueOnce(assignChain)
        .mockReturnValueOnce(favChain);

      const result = await ReportCardService.getFavouritePrescription(
        'doc-1',
        'clinic-1'
      );
      expect(result.favourites).toEqual(mockFavourites);
    });
  });

  describe('getAppoinmentsPrescriptionsReport', () => {
    it('should limit appointment and prescription history to the clinic', async () => {
      const mockAppointments = [
        { id: 'app-1', patientId: 'pat-1', clinicId: 'clinic-1' },
      ];
      const selectChain = createChain(mockAppointments);

      (database.transaction as jest.Mock).mockImplementation(
        async (callback) => {
          const tx = {
            select: jest.fn().mockReturnValue(selectChain),
          };
          return callback(tx);
        }
      );

      const result =
        await ReportHistoryService.getAppoinmentsPrescriptionsReport(
          { patientId: 'pat-1' },
          { typeOfPaginations: 'Appointments' },
          'clinic-1',
          { id: 'rec-1', userType: 'Receptionist' }
        );
      expect(
        result && 'appointments' in result ? result.appointments : undefined
      ).toEqual(mockAppointments);
    });

    it.each(['Prescriptions', 'Medcial history'] as const)(
      'refuses %s to a receptionist',
      async (typeOfPaginations) => {
        await expect(
          ReportHistoryService.getAppoinmentsPrescriptionsReport(
            { patientId: 'pat-1' },
            { typeOfPaginations },
            'clinic-1',
            { id: 'rec-1', userType: 'Receptionist' }
          )
        ).rejects.toMatchObject({ status: 403 });
      }
    );
  });

  // Rows in query order: manual, doctor HTML, named, quick print.
  describe('getResolvedTemplateForPreview purpose', () => {
    const rows = (value: any) => {
      const chain: any = new Proxy(
        {},
        {
          get: (_target, prop) =>
            prop === 'then'
              ? (fn: any) => Promise.resolve(value).then(fn)
              : () => chain,
        }
      );
      return chain;
    };

    const mockDoctorTemplates = (
      quickSavedAt: string,
      elementConfig: Record<string, unknown> = {}
    ) => {
      const results = [
        [],
        [],
        [{ templateName: 'template2', updatedAt: new Date('2026-01-01') }],
        [
          {
            selectedTemplate: 'minimal-prescription',
            elementConfig,
            updatedAt: new Date(quickSavedAt),
          },
        ],
      ];
      (database.select as jest.Mock).mockImplementation(() =>
        rows(results.shift())
      );
    };

    it('prints with Quick Print even when it was saved earlier', async () => {
      mockDoctorTemplates('2025-12-01');
      const result =
        await PrescriptionPrintService.getResolvedTemplateForPreview(
          'doc-1',
          [],
          [],
          null,
          'print'
        );
      expect(result.isQuickPrint).toBe(true);
    });

    it('shares with the prescription template even when Quick Print is newer', async () => {
      mockDoctorTemplates('2026-09-01');
      const result =
        await PrescriptionPrintService.getResolvedTemplateForPreview('doc-1');
      expect(result.isQuickPrint).toBe(false);
    });

    const resolve = (purpose: 'print' | 'share') =>
      PrescriptionPrintService.getResolvedTemplateForPreview(
        'doc-1',
        [],
        [],
        null,
        purpose
      );

    it('uses the prescription template for both when chosen', async () => {
      mockDoctorTemplates('2026-09-01', { templateUsage: 'prescription' });
      expect((await resolve('print')).isQuickPrint).toBe(false);
    });

    it('uses Quick Print for both when chosen', async () => {
      mockDoctorTemplates('2026-09-01', { templateUsage: 'quickPrint' });
      expect((await resolve('share')).isQuickPrint).toBe(true);
    });

    it('prints the default Quick Print layout when only settings are saved', async () => {
      mockDoctorTemplates('2026-09-01', {
        templateUsage: 'separate',
        usageOnly: true,
      });
      expect((await resolve('print')).isQuickPrint).toBe(true);
    });

    it('gives a new clinic Quick Print for printing and the prescription template for sharing', async () => {
      const newClinic = () => {
        const results = [[], [], [], []];
        (database.select as jest.Mock).mockImplementation(() =>
          rows(results.shift())
        );
      };
      newClinic();
      expect((await resolve('print')).isQuickPrint).toBe(true);
      newClinic();
      expect((await resolve('share')).isQuickPrint).toBe(false);
    });
  });

  // The save path builds its PDF exactly like regenerate, so share and print choices apply to it too.
  describe('prescription save PDF', () => {
    it('texts the patient and renders through the shared PDF path', async () => {
      const input = {
        appointment: { id: 'app-1', clinicId: 'clinic-1' },
        patient: { id: 'pat-1', mobile: '9999999999' },
        pdfData: { clinic: { name: 'Test Clinic' } },
      };
      jest
        .spyOn(PrescriptionPrintService as any, 'buildPrescriptionPdfInput')
        .mockResolvedValue(input);
      const regenerate = jest
        .spyOn(PrescriptionPrintService as any, 'regeneratePdf')
        .mockResolvedValue(undefined);
      const sms = jest
        .spyOn(PrescriptionNotificationService, 'sendPrescriptionNotification')
        .mockResolvedValue(undefined as any);

      await (ReportCardService as any).generatePdfAndSendNotifications(
        { id: 'rc-1', appointmentId: 'app-1' },
        { reportCard: { followUpInDays: 7 }, printLanguage: 'hi' }
      );

      expect(sms).toHaveBeenCalledWith(
        'app-1',
        'clinic-1',
        '9999999999',
        'Test Clinic',
        7
      );
      expect(regenerate).toHaveBeenCalledWith('rc-1', 'hi', input);
    });
  });
});
