import logger from '../logger';

describe('Logger Utility', () => {
  it('should format message with circular references without throwing', () => {
    const circularObj: any = { name: 'test' };
    circularObj.self = circularObj;

    expect(() => {
      logger.info('Testing circular serialization', circularObj);
    }).not.toThrow();
  });
});
