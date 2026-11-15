import logger, { redactPii } from '../logger';

describe('redactPii', () => {
  const uuid = '2daa30cf-577f-4818-924b-36c5664fed66';

  it('masks user/patient id, phone and email fields, keeps clinic ids', () => {
    expect(
      redactPii({ userId: uuid, patient_phone: '9876543210', clinicId: uuid })
    ).toEqual({
      userId: '[redacted]',
      patient_phone: '[redacted]',
      clinicId: uuid,
    });
  });

  it('masks phones, emails and user ids inside messages', () => {
    expect(
      redactPii(`SMS to +91 9876543210 for user=${uuid}, mail a@b.com`)
    ).toBe('SMS to [phone] for user=[id], mail [email]');
  });

  it('leaves timestamps, durations and non-plain objects alone', () => {
    const date = new Date(0);
    expect(redactPii('took 1730546400000ms')).toBe('took 1730546400000ms');
    expect(redactPii({ at: date })).toEqual({ at: date });
  });
});

describe('Logger Utility', () => {
  it('should format message with circular references without throwing', () => {
    const circularObj: any = { name: 'test' };
    circularObj.self = circularObj;

    expect(() => {
      logger.info('Testing circular serialization', circularObj);
    }).not.toThrow();
  });
});
