/** "Chrome on Windows" from a browser user agent; the apps show as "Android app" / "iPhone app". */
export function describeDevice(
  platform: string,
  userAgent: string | null
): string {
  if (platform === 'android') return 'Android app';
  if (platform === 'ios') return 'iPhone app';
  if (platform !== 'web') return 'Mobile app';
  if (!userAgent) return 'Web browser';
  const ua = userAgent;
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\//.test(ua)
      ? 'Opera'
      : /Chrome\//.test(ua)
        ? 'Chrome'
        : /Firefox\//.test(ua)
          ? 'Firefox'
          : /Safari\//.test(ua)
            ? 'Safari'
            : 'Browser';
  const os = /Windows/.test(ua)
    ? 'Windows'
    : /Android/.test(ua)
      ? 'Android'
      : /iPhone|iPad/.test(ua)
        ? 'iOS'
        : /Mac OS X/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : null;
  return os ? `${browser} on ${os}` : browser;
}
