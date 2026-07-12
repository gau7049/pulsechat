import imageCompression from 'browser-image-compression';
import { LIMITS } from '@pulsechat/shared';
import { post } from '../../lib/api';
import type { AttachmentMeta } from './message-envelope';

/**
 * Attachment pipeline (§14.8, Tech Spec §10): images are compressed
 * client-side, everything is capped at 10 MB, and bytes go straight to
 * Cloudinary with a short-lived signature — never through the API server.
 */

export type AttachmentKind = 'image' | 'video' | 'audio' | 'document';

/** The picker's kinds map onto Cloudinary resource types. */
const RESOURCE_TYPE: Record<AttachmentKind, 'image' | 'video' | 'raw'> = {
  image: 'image',
  video: 'video',
  audio: 'video', // Cloudinary treats audio as video-pipeline media.
  document: 'raw',
};

interface SignedUpload {
  cloudName: string;
  apiKey: string;
  timestamp: number;
  folder: string;
  publicId: string;
  signature: string;
  uploadUrl: string;
}

export async function uploadAttachment(
  file: File,
  kind: AttachmentKind,
  onProgress?: (fraction: number) => void,
): Promise<AttachmentMeta> {
  let payload: File | Blob = file;
  if (kind === 'image' && file.type !== 'image/gif') {
    // GIFs skip compression to keep animation (§14.4 GIF support).
    payload = await imageCompression(file, {
      maxSizeMB: 2,
      maxWidthOrHeight: 2048,
      useWebWorker: true,
    });
  }
  if (payload.size > LIMITS.MAX_UPLOAD_BYTES) {
    throw new Error('Files are limited to 10 MB');
  }

  const token = await post<SignedUpload>('/uploads/attachment-token', {
    resourceType: RESOURCE_TYPE[kind],
  });

  const form = new FormData();
  form.append('file', payload, file.name);
  form.append('api_key', token.apiKey);
  form.append('timestamp', String(token.timestamp));
  form.append('signature', token.signature);
  form.append('folder', token.folder);
  form.append('public_id', token.publicId);

  // XHR instead of fetch for upload progress.
  const url = await new Promise<string>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', token.uploadUrl);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded / event.total);
    };
    xhr.onload = () => {
      try {
        const body = JSON.parse(xhr.responseText) as { secure_url?: string };
        if (xhr.status < 300 && body.secure_url) resolve(body.secure_url);
        else reject(new Error('Upload failed — try again'));
      } catch {
        reject(new Error('Upload failed — try again'));
      }
    };
    xhr.onerror = () => reject(new Error('Upload failed — check your connection'));
    xhr.send(form);
  });

  return { url, name: file.name, size: payload.size, mimeType: file.type };
}
