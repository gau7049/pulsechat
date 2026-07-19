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
  allowedFormats: string;
  maxFileSize: number;
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
  form.append('allowed_formats', token.allowedFormats);
  form.append('max_file_size', String(token.maxFileSize));

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

/**
 * Group photo upload: same signed-upload flow as attachments/avatars, but the
 * token is scoped to one conversation and overwrites in place (stable public
 * id server-side), so no compression step or size progress is needed here.
 */
export async function uploadGroupPhoto(conversationId: string, file: File): Promise<string> {
  const token = await post<SignedUpload>(`/conversations/${conversationId}/photo-upload-token`);

  const form = new FormData();
  form.append('file', file);
  form.append('api_key', token.apiKey);
  form.append('timestamp', String(token.timestamp));
  form.append('signature', token.signature);
  form.append('folder', token.folder);
  form.append('public_id', token.publicId);
  form.append('overwrite', 'true');
  form.append('allowed_formats', token.allowedFormats);
  form.append('max_file_size', String(token.maxFileSize));

  const upload = await fetch(token.uploadUrl, { method: 'POST', body: form });
  if (!upload.ok) throw new Error('Upload failed');
  const result = (await upload.json()) as { secure_url?: string };
  if (!result.secure_url) throw new Error('Upload failed — try again');
  return result.secure_url;
}
