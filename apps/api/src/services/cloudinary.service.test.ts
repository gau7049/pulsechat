import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * M12: signed uploads must pin allowed_formats/max_file_size into the
 * signature itself (not just a client-side check) — these tests confirm the
 * signature actually matches an independently recomputed one over the exact
 * params Cloudinary requires (sorted, `resource_type`/`api_key`/`file`
 * excluded), and that the constraint values differ sensibly per upload kind.
 */
describe('cloudinary.service signed uploads', () => {
  afterEach(() => {
    vi.doUnmock('../config/env.js');
    vi.resetModules();
  });

  const CLOUDINARY_URL = 'cloudinary://123456:test-secret@demo-cloud';

  function expectedSignature(params: Record<string, string | number | boolean>): string {
    const paramsToSign = Object.keys(params)
      .sort()
      .map((key) => `${key}=${params[key]}`)
      .join('&');
    return createHash('sha1').update(`${paramsToSign}test-secret`).digest('hex');
  }

  it('throws when CLOUDINARY_URL is not configured', async () => {
    vi.doMock('../config/env.js', () => ({ env: {} }));
    const { signUpload } = await import('./cloudinary.service.js');
    expect(() => signUpload('user-1', 'avatar')).toThrow(/not configured/i);
  });

  it('signs an avatar upload with image-only formats and a 10 MB cap', async () => {
    vi.doMock('../config/env.js', () => ({ env: { CLOUDINARY_URL } }));
    const { signUpload } = await import('./cloudinary.service.js');
    const result = signUpload('user-1', 'avatar');

    expect(result.allowedFormats).toBe('jpg,jpeg,png,webp,gif');
    expect(result.maxFileSize).toBe(10 * 1024 * 1024);
    expect(result.signature).toBe(
      expectedSignature({
        allowed_formats: result.allowedFormats,
        folder: result.folder,
        max_file_size: result.maxFileSize,
        overwrite: true,
        public_id: result.publicId,
        timestamp: result.timestamp,
      }),
    );
  });

  it('narrows allowed formats per attachment resource type', async () => {
    vi.doMock('../config/env.js', () => ({ env: { CLOUDINARY_URL } }));
    const { signAttachmentUpload } = await import('./cloudinary.service.js');

    const image = signAttachmentUpload('user-1', 'image');
    const video = signAttachmentUpload('user-1', 'video');
    const raw = signAttachmentUpload('user-1', 'raw');

    expect(image.allowedFormats).toBe('jpg,jpeg,png,webp,gif');
    expect(video.allowedFormats).toContain('mp4');
    expect(video.allowedFormats).toContain('mp3'); // video resource type also carries audio
    expect(raw.allowedFormats).toContain('pdf');
    expect(raw.allowedFormats).not.toContain('mp4');

    expect(raw.signature).toBe(
      expectedSignature({
        allowed_formats: raw.allowedFormats,
        folder: raw.folder,
        max_file_size: raw.maxFileSize,
        public_id: raw.publicId,
        timestamp: raw.timestamp,
      }),
    );
  });

  it('signs a group photo upload the same way as an avatar (overwrite in place)', async () => {
    vi.doMock('../config/env.js', () => ({ env: { CLOUDINARY_URL } }));
    const { signGroupPhotoUpload } = await import('./cloudinary.service.js');
    const result = signGroupPhotoUpload('conversation-1');

    expect(result.publicId).toBe('group_conversation-1');
    expect(result.allowedFormats).toBe('jpg,jpeg,png,webp,gif');
    expect(result.signature).toBe(
      expectedSignature({
        allowed_formats: result.allowedFormats,
        folder: result.folder,
        max_file_size: result.maxFileSize,
        overwrite: true,
        public_id: result.publicId,
        timestamp: result.timestamp,
      }),
    );
  });
});
