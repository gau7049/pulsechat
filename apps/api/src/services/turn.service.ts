import { createHmac } from 'node:crypto';
import { LIMITS, type IceServersDto } from '@pulsechat/shared';
import { env } from '../config/env.js';

/**
 * ICE server list for WebRTC calls/live (Technical Spec §11). Google's public
 * STUN is always included and free. TURN is self-hosted coturn on the Oracle
 * Always-Free VM (still pending manual provisioning — see `infra/coturn/README.md`)
 * using the turnserver REST-API shared-secret credential
 * scheme: no static creds ever ship to the client, and when TURN_HOST/
 * TURN_SHARED_SECRET are unset the client simply gets STUN-only, which is
 * this milestone's explicit "works same-network, degrades gracefully" bar.
 */
export function getIceServers(userId: string): IceServersDto {
  const iceServers: IceServersDto['iceServers'] = [{ urls: ['stun:stun.l.google.com:19302'] }];

  if (env.TURN_HOST && env.TURN_SHARED_SECRET) {
    const expiresAt = Math.floor(Date.now() / 1000) + LIMITS.TURN_CREDENTIAL_TTL_SECONDS;
    const username = `${expiresAt}:${userId}`;
    const credential = createHmac('sha1', env.TURN_SHARED_SECRET).update(username).digest('base64');
    iceServers.push({
      urls: [`turn:${env.TURN_HOST}:3478`, `turn:${env.TURN_HOST}:3478?transport=tcp`],
      username,
      credential,
    });
  }

  return { iceServers };
}
