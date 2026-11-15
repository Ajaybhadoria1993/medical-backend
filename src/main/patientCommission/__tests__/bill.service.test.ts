import { registerAppointmentsPort } from '../ports';
import type { AppointmentsPort } from '../ports';
import { BillService } from '../services/bill.service';
import { PricingService } from '../services/pricing.service';
import { DEFAULT_COMMISSION_PRICING } from '../utils/commissionPricing.utils';

jest.mock('../services/pricing.service', () => ({
  PricingService: { resolveFor: jest.fn() },
}));

const resolveFor = PricingService.resolveFor as jest.Mock;

const port: jest.Mocked<AppointmentsPort> = {
  countByDoctor: jest.fn(),
  listForDoctor: jest.fn(),
  getDoctorName: jest.fn(),
};

const admin = { id: 'admin-1', userType: 'Admin' };
const doctors = [
  { doctorId: 'd-rao', name: 'Rao', patients: 0 },
  { doctorId: 'd-gupta', name: 'Gupta', patients: 200 },
  { doctorId: 'd-sharma', name: 'Sharma', patients: 600 },
];

beforeEach(() => {
  jest.useFakeTimers().setSystemTime(new Date('2026-11-14T10:00:00+05:30'));
  jest.clearAllMocks();
  registerAppointmentsPort(port);
  resolveFor.mockResolvedValue({
    pricing: DEFAULT_COMMISSION_PRICING,
    source: 'default',
  });
  port.countByDoctor.mockResolvedValue(doctors);
});

afterEach(() => {
  jest.useRealTimers();
});

describe('BillService.overview', () => {
  it('prices each doctor by their own patient count', async () => {
    const out = await BillService.overview({ clinicId: 'c1', actor: admin });
    const byName = Object.fromEntries(out.doctors.map((d) => [d.name, d]));
    // Sharma reached 500, Gupta did not: the clinic total (800) does not lift Gupta's rate.
    expect(byName.Sharma).toMatchObject({ ratePaise: 800, amountPaise: 480000 });
    expect(byName.Gupta).toMatchObject({ ratePaise: 1000, amountPaise: 200000 });
    expect(byName.Rao).toMatchObject({ patients: 0, amountPaise: 0 });
  });

  it("adds the doctors' lines into the clinic total", async () => {
    const out = await BillService.overview({ clinicId: 'c1', actor: admin });
    expect(out.totals).toEqual({ patients: 800, amountPaise: 680000 });
  });

  it('lists doctors with the most patients first', async () => {
    const out = await BillService.overview({ clinicId: 'c1', actor: admin });
    expect(out.doctors.map((d) => d.name)).toEqual(['Sharma', 'Gupta', 'Rao']);
  });

  it('shows how many more patients reach the next rate', async () => {
    const out = await BillService.overview({ clinicId: 'c1', actor: admin });
    const gupta = out.doctors.find((d) => d.name === 'Gupta');
    expect(gupta?.nextTier).toEqual({
      atPatients: 500,
      ratePaise: 800,
      remaining: 300,
    });
  });

  it('shows a Doctor only their own line and total', async () => {
    const out = await BillService.overview({
      clinicId: 'c1',
      actor: { id: 'd-gupta', userType: 'Doctor' },
    });
    expect(out.doctors.map((d) => d.doctorId)).toEqual(['d-gupta']);
    expect(out.totals).toEqual({ patients: 200, amountPaise: 200000 });
  });

  it('describes the current monthly period', async () => {
    const out = await BillService.overview({ clinicId: 'c1', actor: admin });
    expect(out.period).toMatchObject({
      startDate: '2026-11-01',
      endDate: '2026-11-30',
      nextStartDate: '2026-12-01',
      isCurrent: true,
      previousDate: '2026-10-31',
      nextDate: null,
    });
    expect(port.countByDoctor).toHaveBeenCalledWith(
      'c1',
      '2026-11-01',
      '2026-12-01'
    );
  });

  it('can show an earlier period, with a way forward', async () => {
    const out = await BillService.overview({
      clinicId: 'c1',
      actor: admin,
      date: '2026-10-20',
    });
    expect(out.period).toMatchObject({
      startDate: '2026-10-01',
      isCurrent: false,
      nextDate: '2026-11-01',
    });
    // The pricing is the one in force that day.
    expect(resolveFor).toHaveBeenCalledWith(
      'c1',
      new Date('2026-10-20T00:00:00+05:30')
    );
  });

  it('follows a half-monthly pricing', async () => {
    resolveFor.mockResolvedValue({
      pricing: { ...DEFAULT_COMMISSION_PRICING, periodKind: 'half_monthly' },
      source: 'clinic',
    });
    const out = await BillService.overview({ clinicId: 'c1', actor: admin });
    expect(out.period).toMatchObject({
      startDate: '2026-11-01',
      endDate: '2026-11-15',
      nextStartDate: '2026-11-16',
    });
    expect(out.pricing.source).toBe('clinic');
  });

  it('refuses a future date', async () => {
    await expect(
      BillService.overview({ clinicId: 'c1', actor: admin, date: '2026-11-15' })
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe('BillService.doctorAppointments', () => {
  const base = {
    clinicId: 'c1',
    doctorId: 'd-sharma',
    pageNumber: 1,
    pageSize: 25,
  };

  beforeEach(() => {
    port.getDoctorName.mockResolvedValue('Sharma');
    port.listForDoctor.mockResolvedValue({ total: 0, items: [] });
  });

  it("stops a Doctor reading another doctor's patients", async () => {
    await expect(
      BillService.doctorAppointments({
        ...base,
        actor: { id: 'd-gupta', userType: 'Doctor' },
      })
    ).rejects.toMatchObject({ status: 403 });
    expect(port.listForDoctor).not.toHaveBeenCalled();
  });

  it('lets a Doctor read their own and an Admin read any', async () => {
    await expect(
      BillService.doctorAppointments({
        ...base,
        actor: { id: 'd-sharma', userType: 'Doctor' },
      })
    ).resolves.toMatchObject({ doctor: { id: 'd-sharma', name: 'Sharma' } });
    await expect(
      BillService.doctorAppointments({ ...base, actor: admin })
    ).resolves.toBeDefined();
  });

  it('is a 404 for a doctor who is not in this clinic', async () => {
    port.getDoctorName.mockResolvedValue(null);
    await expect(
      BillService.doctorAppointments({ ...base, actor: admin })
    ).rejects.toMatchObject({ status: 404 });
  });

  it('pages through the period of the chosen date', async () => {
    port.listForDoctor.mockResolvedValue({ total: 120, items: [] });
    const out = await BillService.doctorAppointments({
      ...base,
      actor: admin,
      pageNumber: 3,
      date: '2026-10-20',
    });
    expect(port.listForDoctor).toHaveBeenCalledWith(
      'c1',
      'd-sharma',
      '2026-10-01',
      '2026-11-01',
      25,
      50
    );
    expect(out.total).toBe(120);
    expect(out.period.startDate).toBe('2026-10-01');
  });
});
