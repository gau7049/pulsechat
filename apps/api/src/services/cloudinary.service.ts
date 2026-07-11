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
}

/**
 * Sign an upload scoped to a folder + public id (per-user, per-purpose).
 * Signature scheme per Cloudinary docs: SHA-1 of the sorted param string +
 * API secret.
 */
export function signUpload(userId: string, purpose: 'avatar'): SignedUpload {
  const config = parseCloudinaryUrl();
  if (!config) {
    throw new AppError(
      'VALIDATION_FAILED',
      'Media uploads are not configured yet (CLOUDINARY_URL missing)',
    );
  }
  const timestamp = Math.floor(Date.now() / 1000);
  const folder = `pulsechat/${purpose}`;
  const publicId = `${purpose}_${userId}`;
  const paramsToSign = `folder=${folder}&overwrite=true&public_id=${publicId}&timestamp=${timestamp}`;
  const signature = createHash('sha1')
    .update(paramsToSign + config.apiSecret)
    .digest('hex');

  return {
    cloudName: config.cloudName,
    apiKey: config.apiKey,
    timestamp,
    folder,
    publicId,
    signature,
    uploadUrl: `https://api.cloudinary.com/v1_1/${config.cloudName}/image/upload`,
  };
}
