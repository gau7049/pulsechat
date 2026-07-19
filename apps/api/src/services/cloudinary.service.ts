import { createHash } from 'node:crypto';
import { env } from '../config/env.js';
import { AppError } from '../http/errors.js';

/**
 * Signed direct-upload tokens (Technical Spec §10): the client uploads
 * straight to Cloudinary; the API only signs the request. File bytes never
 * pass through this server.
 */

interface CloudinaryConfig {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
}

function parseCloudinaryUrl(): CloudinaryConfig | null {
  if (!env.CLOUDINARY_URL) return null;
  const match = env.CLOUDINARY_URL.match(/^cloudinary:\/\/(\d+):([^@]+)@(.+)$/);
  if (!match) return null;
  return { apiKey: match[1]!, apiSecret: match[2]!, cloudName: match[3]! };
}

export interface SignedUpload {
  cloudName: string;
  apiKey: string;
  timestamp: number;
  folder: string;
  publicId: string;
  signature: string;
  uploadUrl: string;
  /**
   * M12: the signature only constrains what it actually covers — these two
   * travel with it so the constraint can't be bypassed by a client simply
   * omitting them from the upload request (Cloudinary rejects an upload
   * whose params don't match what was signed).
   */
  allowedFormats: string;
  maxFileSize: number;
}

/** 10 MB everywhere — matches the client-side cap `attachments.ts` already enforces. */
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

/** Common raster formats — covers avatars and group photos, both `image` resource type. */
const IMAGE_FORMATS = 'jpg,jpeg,png,webp,gif';

function sign(config: CloudinaryConfig, params: Record<string, string | number | boolean>): string {
  const paramsToSign = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('&');
  return createHash('sha1')
    .update(paramsToSign + config.apiSecret)
    .digest('hex');
}

/**
 * Sign an upload scoped to a folder + public id (per-user, per-purpose).
 * Signature scheme per Cloudinary docs: SHA-1 of the sorted param string +
 * API secret.
 */
export function signUpload(userId: string, purpose: 'avatar'): SignedUpload {
  const config = requireConfig();
  const timestamp = Math.floor(Date.now() / 1000);
  const folder = `pulsechat/${purpose}`;
  const publicId = `${purpose}_${userId}`;
  const signature = sign(config, {
    allowed_formats: IMAGE_FORMATS,
    folder,
    max_file_size: MAX_FILE_SIZE_BYTES,
    overwrite: true,
    public_id: publicId,
    timestamp,
  });

  return {
    cloudName: config.cloudName,
    apiKey: config.apiKey,
    timestamp,
    folder,
    publicId,
    signature,
    uploadUrl: `https://api.cloudinary.com/v1_1/${config.cloudName}/image/upload`,
    allowedFormats: IMAGE_FORMATS,
    maxFileSize: MAX_FILE_SIZE_BYTES,
  };
}

/** Chat attachment kinds map to Cloudinary resource types (Tech Spec §10). */
export type AttachmentResourceType = 'image' | 'video' | 'raw';

/** Per resource-type allowlist — narrows what §14.8's picker can actually push through. */
const ATTACHMENT_FORMATS: Record<AttachmentResourceType, string> = {
  image: IMAGE_FORMATS,
  // 'video' resource type also covers audio uploads (attachments.ts maps both kinds here).
  video: 'mp4,mov,webm,m4v,mp3,wav,m4a,ogg,aac',
  raw: 'pdf,doc,docx,xls,xlsx,ppt,pptx,txt,csv,zip',
};

/**
 * Attachment uploads (§14.8): unique public id per upload, resource type
 * chosen by the picker (video also covers audio; raw covers documents).
 */
export function signAttachmentUpload(
  userId: string,
  resourceType: AttachmentResourceType,
): SignedUpload {
  const config = requireConfig();
  const timestamp = Math.floor(Date.now() / 1000);
  const folder = `pulsechat/attachments/${userId}`;
  const publicId = `att_${timestamp}_${Math.random().toString(36).slice(2, 10)}`;
  const allowedFormats = ATTACHMENT_FORMATS[resourceType];
  const signature = sign(config, {
    allowed_formats: allowedFormats,
    folder,
    max_file_size: MAX_FILE_SIZE_BYTES,
    public_id: publicId,
    timestamp,
  });

  return {
    cloudName: config.cloudName,
    apiKey: config.apiKey,
    timestamp,
    folder,
    publicId,
    signature,
    uploadUrl: `https://api.cloudinary.com/v1_1/${config.cloudName}/${resourceType}/upload`,
    allowedFormats,
    maxFileSize: MAX_FILE_SIZE_BYTES,
  };
}

/**
 * Group photo uploads: stable public id per conversation (overwrite in place),
 * same shape as the avatar upload. Permission (admin-or-creator) is checked by
 * the caller before this is ever signed.
 */
export function signGroupPhotoUpload(conversationId: string): SignedUpload {
  const config = requireConfig();
  const timestamp = Math.floor(Date.now() / 1000);
  const folder = 'pulsechat/group-photos';
  const publicId = `group_${conversationId}`;
  const signature = sign(config, {
    allowed_formats: IMAGE_FORMATS,
    folder,
    max_file_size: MAX_FILE_SIZE_BYTES,
    overwrite: true,
    public_id: publicId,
    timestamp,
  });

  return {
    cloudName: config.cloudName,
    apiKey: config.apiKey,
    timestamp,
    folder,
    publicId,
    signature,
    uploadUrl: `https://api.cloudinary.com/v1_1/${config.cloudName}/image/upload`,
    allowedFormats: IMAGE_FORMATS,
    maxFileSize: MAX_FILE_SIZE_BYTES,
  };
}

function requireConfig(): CloudinaryConfig {
  const config = parseCloudinaryUrl();
  if (!config) {
    throw new AppError(
      'VALIDATION_FAILED',
      'Media uploads are not configured yet (CLOUDINARY_URL missing)',
    );
  }
  return config;
}
