import {
  decodedBase64Bytes,
  detectBridgeFileType,
  MAX_BRIDGE_UPLOAD_BYTES,
  scanBridgeUploadSchema,
} from '../validators/scan.bridge.validator';

// Pads a real file signature to a base64 string that decodes to roughly `bytes` bytes.
const payloadOf = (prefix: string, bytes: number) =>
  prefix + 'A'.repeat(Math.ceil((bytes * 4) / 3) - prefix.length);

const messagesFor = (imageBase64: string) => {
  const result = scanBridgeUploadSchema.safeParse({ imageBase64 });
  return result.success ? [] : result.error.issues.map((i) => i.message);
};

describe('scanBridgeUploadSchema', () => {
  it('accepts JPEG, PNG and PDF under 5 MB', () => {
    for (const prefix of ['/9j/', 'iVBORw0KGgo', 'JVBER']) {
      expect(
        scanBridgeUploadSchema.safeParse({
          imageBase64: payloadOf(prefix, 1024 * 1024),
        }).success
      ).toBe(true);
    }
  });

  it('rejects an unsupported file type with an actionable message', () => {
    expect(detectBridgeFileType('R0lGODlh')).toBeNull(); // GIF
    expect(messagesFor(payloadOf('R0lGODlh', 1024))).toContain(
      'Upload a JPG, PNG or PDF file.'
    );
  });

  it('rejects a file over 5 MB', () => {
    const tooBig = payloadOf('JVBER', MAX_BRIDGE_UPLOAD_BYTES + 1024);
    expect(decodedBase64Bytes(tooBig)).toBeGreaterThan(MAX_BRIDGE_UPLOAD_BYTES);
    expect(
      messagesFor(tooBig).some((m) => m.startsWith('File is larger than 5 MB'))
    ).toBe(true);
  });

  it('allows a file of exactly 5 MB', () => {
    const exact = '/9j/' + 'A'.repeat((MAX_BRIDGE_UPLOAD_BYTES / 3) * 4 - 4);
    expect(decodedBase64Bytes(exact)).toBeLessThanOrEqual(
      MAX_BRIDGE_UPLOAD_BYTES
    );
    expect(
      scanBridgeUploadSchema.safeParse({ imageBase64: exact }).success
    ).toBe(true);
  });
});

describe('scanBridgeUploadSchema issue order', () => {
  it('lists the readable 5 MB message last when the shared 8 MB rule also fires', () => {
    const huge = payloadOf('JVBER', 7 * 1024 * 1024);
    const messages = messagesFor(huge);
    expect(messages[messages.length - 1]).toMatch(/^File is larger than 5 MB/);
  });
});
