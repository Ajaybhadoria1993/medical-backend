import { PrescriptionSectionService } from '../services/prescriptionSection.service';
import { isDoctorAssignedToClinic } from '../../../utils/clinicOwnership';

jest.mock('../../../utils/clinicOwnership', () => ({
  isDoctorAssignedToClinic: jest.fn(),
}));

describe('PrescriptionSectionService.assertCanManage', () => {
  const assigned = isDoctorAssignedToClinic as jest.Mock;

  it('lets a doctor manage their own switches', async () => {
    await expect(
      PrescriptionSectionService.assertCanManage(
        'd1',
        { id: 'd1', userType: 'Doctor' },
        'c1'
      )
    ).resolves.toBeUndefined();
  });

  it('lets a clinic admin manage a doctor in their clinic', async () => {
    assigned.mockResolvedValueOnce(true);

    await expect(
      PrescriptionSectionService.assertCanManage(
        'd2',
        { id: 'a1', userType: 'Admin' },
        'c1'
      )
    ).resolves.toBeUndefined();
    expect(assigned).toHaveBeenCalledWith('d2', 'c1');
  });

  it('hides another clinic’s doctor from an admin, and any other doctor from a doctor', async () => {
    assigned.mockResolvedValueOnce(false);

    await expect(
      PrescriptionSectionService.assertCanManage(
        'd3',
        { id: 'a1', userType: 'Admin' },
        'c1'
      )
    ).rejects.toThrow('Doctor not found');
    await expect(
      PrescriptionSectionService.assertCanManage(
        'd2',
        { id: 'd1', userType: 'Doctor' },
        'c1'
      )
    ).rejects.toThrow('Doctor not found');
  });
});

describe('PrescriptionSectionService on Quick Print', () => {
  it('drops sections the doctor switched off, but never a locked one', () => {
    const result = PrescriptionSectionService.applySwitchedOff(
      { showVitals: false, showDiagnosis: true, showPatientName: true },
      { showVitals: true, showDiagnosis: false, showPatientName: false }
    );

    expect(result).toEqual({
      showVitals: false,
      showDiagnosis: false,
      showPatientName: true,
    });
  });

  it('ignores a switch that is off by default, so Quick Print keeps deciding the QR', () => {
    const result = PrescriptionSectionService.applySwitchedOff(
      { showQrCode: true },
      { showQrCode: false }
    );

    expect(result).toEqual({ showQrCode: true });
  });

  it('leaves the layout untouched when the doctor has no switches saved', () => {
    const flags = { showVitals: false };

    expect(PrescriptionSectionService.applySwitchedOff(flags, null)).toEqual(
      flags
    );
  });

  it('lists only the catalogue switches a template guards on, in catalogue order', () => {
    expect(
      PrescriptionSectionService.templateSectionKeys(
        '{{#if config.elements.showDiagnosis}}{{#if config.elements.showPatientUhid}}{{#if config.elements.showVitals}}'
      )
    ).toEqual(['showVitals', 'showDiagnosis']);
  });

  it('maps switched-off sections to designer blocks, never a block carrying a locked section', () => {
    expect(
      PrescriptionSectionService.hiddenBlockIds({
        showVitals: true,
        showDiagnosis: false,
        showMedicineTable: false,
      })
    ).toEqual(['diagnosis']);
  });
});
