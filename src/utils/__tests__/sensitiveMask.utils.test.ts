import { HIDDEN_TEXT, maskSensitive } from '../sensitiveMask.utils';

describe('maskSensitive', () => {
  it('masks contact details and ID numbers, keeps ids, dates and statuses', () => {
    const out = maskSensitive({
      id: 'u1',
      clinicId: 'c1',
      status: 'Active',
      createdAt: '2026-10-01',
      mobile: '9876543210',
      email: 'ravi.sharma@gmail.com',
      gstNumber: '27ABCDE1234F1Z5',
      pan: 'ABCDE1234F',
      address: '12 MG Road',
      ipAddress: '103.21.44.9',
      clinicName: 'Sunrise Dental',
    });
    expect(out).toEqual({
      id: 'u1',
      clinicId: 'c1',
      status: 'Active',
      createdAt: '2026-10-01',
      mobile: '98******10',
      email: 'ra***@gmail.com',
      gstNumber: 'XXXXF1Z5',
      pan: 'XXXX234F',
      address: '****',
      ipAddress: '103.21.*.*',
      clinicName: 'Sunrise Dental',
    });
  });

  it('masks names only under a patient, and hides clinical text keeping shape', () => {
    const out = maskSensitive({
      doctorName: 'Dr Mehta',
      patient: { id: 'p1', name: 'Ravi Sharma', dob: '1990-01-01' },
      prescription: {
        id: 'rx1',
        medicines: [{ name: 'Azithral 500', dosage: '1-0-1', durationDays: 5 }],
        createdAt: '2026-10-01',
      },
      diagnosis: 'Acute sinusitis',
      appointmentCount: 3,
    }) as Record<string, any>;

    expect(out.doctorName).toBe('Dr Mehta');
    expect(out.patient).toEqual({ id: 'p1', name: 'R*** S***', dob: '****' });
    expect(out.prescription.id).toBe('rx1');
    expect(out.prescription.createdAt).toBe('2026-10-01');
    expect(out.prescription.medicines[0].name).toBe(HIDDEN_TEXT);
    expect(out.prescription.medicines[0].durationDays).toBeNull();
    expect(out.diagnosis).toBe(HIDDEN_TEXT);
    expect(out.appointmentCount).toBe(3);
  });

  it('masks the patients list (shipped as `petients`) and linked family numbers', () => {
    const out = maskSensitive({
      result: {
        petients: [
          {
            id: 'p2',
            name: 'Rohit D',
            linkedNumber: '8109531494',
            linkedTo: 'Ramat',
          },
        ],
      },
    }) as { result: { petients: Record<string, unknown>[] } };
    expect(out.result.petients[0]).toEqual({
      id: 'p2',
      name: 'R*** D***',
      linkedNumber: '81******94',
      linkedTo: 'R***',
    });
  });

  it("keeps a doctor's name inside a patient row", () => {
    const out = maskSensitive({
      patientAppointments: [
        { name: 'Ravi Sharma', doctor: { name: 'Amit Verma' } },
      ],
    });
    expect(out).toEqual({
      patientAppointments: [
        { name: 'R*** S***', doctor: { name: 'Amit Verma' } },
      ],
    });
  });

  it('keeps pharmacy report figures, masks a bank account holder', () => {
    const out = maskSensitive({
      topSellingMedicines: [{ medicineName: 'Paracetamol 500', quantity: 40 }],
      payoutAccount: { accountHolderName: 'Amit Verma', bankName: 'HDFC' },
    });
    expect(out).toEqual({
      topSellingMedicines: [{ medicineName: 'Paracetamol 500', quantity: 40 }],
      payoutAccount: { accountHolderName: 'A*** V***', bankName: 'HDFC' },
    });
  });

  it('drops stored files and secrets, and reads the same when masked twice', () => {
    const isFile = (v: string) => v.startsWith('uploads/');
    const once = maskSensitive(
      { logo: 'uploads/a.png', password: 'x', phone: '9876543210' },
      { isFile }
    );
    expect(once).toEqual({ logo: null, password: null, phone: '98******10' });
    expect(maskSensitive(once, { isFile })).toEqual(once);
  });
});
