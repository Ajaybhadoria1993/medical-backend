import { describeDevice } from '../utils/device.utils';

describe('describeDevice', () => {
  it('names common browsers and systems', () => {
    expect(
      describeDevice(
        'web',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36'
      )
    ).toBe('Chrome on Windows');
    expect(
      describeDevice(
        'web',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15'
      )
    ).toBe('Safari on macOS');
    expect(
      describeDevice(
        'web',
        'Mozilla/5.0 (Windows NT 10.0) Chrome/129.0 Safari/537.36 Edg/129.0'
      )
    ).toBe('Edge on Windows');
  });

  it('handles the app and a missing agent', () => {
    expect(describeDevice('android', 'okhttp/4.12')).toBe('Android app');
    expect(describeDevice('ios', null)).toBe('iPhone app');
    expect(describeDevice('mobile', 'okhttp/4.12')).toBe('Mobile app');
    expect(describeDevice('web', null)).toBe('Web browser');
  });
});
