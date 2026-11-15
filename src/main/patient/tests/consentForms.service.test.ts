// Medical Records consent list: appointment and plan consents merged, newest first.
const selectResults: unknown[][] = [];

jest.mock('../../../configurations/dbConnection', () => {
  const chain = {
    from: () => chain,
    innerJoin: () => chain,
    leftJoin: () => chain,
    where: () => Promise.resolve(selectResults.shift() ?? []),
  };
  return { database: { select: () => chain } };
});

const planConsentForms = jest.fn();
jest.mock('../../treatmentPlan', () => ({
  planConsentForms: (...args: unknown[]) => planConsentForms(...args),
}));

import { PatientConsentFormsService } from '../services/consentForms.service';
import type { AuthUser } from '../../../middlewear/auth.middleware';

const doctor = { id: 'doc-1', userType: 'Doctor' } as AuthUser;

beforeEach(() => {
  selectResults.length = 0;
  planConsentForms.mockReset();
});

describe('PatientConsentFormsService.list', () => {
  it('merges both sources newest first, with plan doctor names', async () => {
    selectResults.push(
      [{ id: 'appt-1', date: new Date('2026-10-20'), doctorName: 'Rad' }],
      [{ id: 'doc-2', name: 'Asha' }]
    );
    planConsentForms.mockResolvedValue([
      {
        planId: 'plan-1',
        title: 'Teeth whitening',
        optionLabel: 'A',
        doctorId: 'doc-2',
        acceptedAt: new Date('2026-10-22'),
      },
    ]);

    const forms = await PatientConsentFormsService.list(
      'clinic-1',
      doctor,
      'patient-1'
    );

    expect(forms).toEqual([
      {
        source: 'plan',
        id: 'plan-1',
        title: 'Teeth whitening (Option A)',
        doctorName: 'Asha',
        date: new Date('2026-10-22'),
      },
      {
        source: 'appointment',
        id: 'appt-1',
        title: 'Appointment Consent',
        doctorName: 'Rad',
        date: new Date('2026-10-20'),
      },
    ]);
  });

  it('passes the caller to the plan module so its own scope applies', async () => {
    selectResults.push([]);
    planConsentForms.mockResolvedValue([]);

    await expect(
      PatientConsentFormsService.list('clinic-1', doctor, 'patient-1')
    ).resolves.toEqual([]);
    expect(planConsentForms).toHaveBeenCalledWith(
      'clinic-1',
      { id: 'doc-1', isDoctor: true, userType: 'Doctor' },
      'patient-1'
    );
  });
});
