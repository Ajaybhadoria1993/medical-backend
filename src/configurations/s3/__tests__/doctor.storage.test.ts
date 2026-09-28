import { isAllowedManualPrescriptionFile } from '../doctor.storage';

describe('isAllowedManualPrescriptionFile', () => {
  it('accepts images and PDFs whose extension matches their type', () => {
    expect(
      isAllowedManualPrescriptionFile(
        'Prescription_mohini_17-Sep-2026_Token-6.pdf',
        'application/pdf'
      )
    ).toBe(true);
    expect(isAllowedManualPrescriptionFile('scan.JPG', 'image/jpeg')).toBe(
      true
    );
    expect(isAllowedManualPrescriptionFile('scan.jpeg', 'image/jpeg')).toBe(
      true
    );
    expect(isAllowedManualPrescriptionFile('scan.png', 'image/png')).toBe(true);
    expect(isAllowedManualPrescriptionFile('scan.webp', 'image/webp')).toBe(
      true
    );
  });

  it('rejects other file types', () => {
    expect(
      isAllowedManualPrescriptionFile(
        'notes.docx',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      )
    ).toBe(false);
    expect(isAllowedManualPrescriptionFile('photo.gif', 'image/gif')).toBe(
      false
    );
    expect(
      isAllowedManualPrescriptionFile('noextension', 'application/pdf')
    ).toBe(false);
  });

  it('rejects a file whose extension and type disagree', () => {
    expect(
      isAllowedManualPrescriptionFile('invoice.pdf', 'application/x-msdownload')
    ).toBe(false);
    expect(
      isAllowedManualPrescriptionFile('image.png', 'application/pdf')
    ).toBe(false);
  });
});
