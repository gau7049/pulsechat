import type { IceServersDto } from '@pulsechat/shared';
import { get } from '../../lib/api';

/**
 * Thin WebRTC helpers shared by 1:1 calls and the live mesh broadcast
 * (Requirement Scope §12, §14.4, Technical Spec §11). STUN always works;
 * TURN is added automatically when the API reports it's configured — no
 * static credentials ever live in this file.
 */

let cachedIceServers: RTCIceServer[] | null = null;

export async function getIceServers(): Promise<RTCIceServer[]> {
  if (cachedIceServers) return cachedIceServers;
  const { iceServers } = await get<IceServersDto>('/rtc/ice-servers');
  cachedIceServers = iceServers.map((server) => ({
    urls: server.urls,
    ...(server.username ? { username: server.username } : {}),
    ...(server.credential ? { credential: server.credential } : {}),
  }));
  return cachedIceServers;
}

export interface PeerConnectionHandlers {
  onIceCandidate: (candidate: RTCIceCandidateInit) => void;
  onTrack: (stream: MediaStream) => void;
}

export async function createPeerConnection(
  handlers: PeerConnectionHandlers,
): Promise<RTCPeerConnection> {
  const iceServers = await getIceServers();
  const pc = new RTCPeerConnection({ iceServers });
  pc.onicecandidate = (event) => {
    if (event.candidate) handlers.onIceCandidate(event.candidate.toJSON());
  };
  pc.ontrack = (event) => {
    const [stream] = event.streams;
    if (stream) handlers.onTrack(stream);
  };
  return pc;
}

export function getLocalStream(kind: 'audio' | 'video'): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia(
    kind === 'video' ? { audio: true, video: true } : { audio: true, video: false },
  );
}

export function attachLocalTracks(pc: RTCPeerConnection, stream: MediaStream): void {
  for (const track of stream.getTracks()) pc.addTrack(track, stream);
}

export function stopStream(stream: MediaStream | null | undefined): void {
  stream?.getTracks().forEach((track) => track.stop());
}

/**
 * `addIceCandidate` requires a remote description to already be set — the
 * signaling order isn't guaranteed, so candidates arriving early are queued
 * and flushed once `setRemoteDescription` resolves.
 */
export function makeCandidateQueue(pc: RTCPeerConnection) {
  const queue: RTCIceCandidateInit[] = [];
  return {
    add(candidate: RTCIceCandidateInit): void {
      if (pc.remoteDescription) {
        void pc.addIceCandidate(candidate).catch(() => undefined);
      } else {
        queue.push(candidate);
      }
    },
    flush(): void {
      for (const candidate of queue.splice(0)) {
        void pc.addIceCandidate(candidate).catch(() => undefined);
      }
    },
  };
}
