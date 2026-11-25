import type { ClientWsMessage, RtcConfigResponse } from '../shared/types';
import { safeFetchJson } from './safeFetch';

export type PeerConnectionStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'failed' | 'unsupported';

interface CaptureCapableVideoElement extends HTMLVideoElement {
  captureStream?: () => MediaStream;
  mozCaptureStream?: () => MediaStream;
}

export function supportsVideoCaptureStream(): boolean {
  if (typeof document === 'undefined' || typeof RTCPeerConnection === 'undefined') return false;
  const testEl = document.createElement('video') as CaptureCapableVideoElement;
  return typeof testEl.captureStream === 'function' || typeof testEl.mozCaptureStream === 'function';
}

export function captureMediaStreamFromVideo(videoEl: HTMLVideoElement): MediaStream | null {
  const el = videoEl as CaptureCapableVideoElement;
  try {
    if (typeof el.captureStream === 'function') {
      return el.captureStream();
    }
    if (typeof el.mozCaptureStream === 'function') {
      return el.mozCaptureStream();
    }
    return null;
  } catch {
    return null;
  }
}

export async function fetchRtcConfig(token: string): Promise<RtcConfigResponse> {
  const defaultConfig: RtcConfigResponse = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
    ],
    hasTurn: false,
  };

  if (!token || token === 'firestore-auth') {
    return defaultConfig;
  }

  try {
    const result = await safeFetchJson<RtcConfigResponse>('/api/rtc-config', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!result.ok || !result.isJson || !result.data?.iceServers) {
      return defaultConfig;
    }
    return result.data;
  } catch {
    return defaultConfig;
  }
}

/**
 * Admin-side WebRTC broadcaster.
 * Captures the local HTMLVideoElement media stream and streams directly to each Viewer peer.
 */
export class AdminWebRtcManager {
  private peers = new Map<string, RTCPeerConnection>();
  private pendingIce = new Map<string, RTCIceCandidateInit[]>();
  private iceServers: RTCIceServer[];
  private sendSignal: (msg: ClientWsMessage) => void;
  private getStream: () => MediaStream | null;
  private onPeerStatusChange?: (viewerId: string, status: PeerConnectionStatus) => void;

  constructor(params: {
    iceServers: RTCIceServer[];
    sendSignal: (msg: ClientWsMessage) => void;
    getStream: () => MediaStream | null;
    onPeerStatusChange?: (viewerId: string, status: PeerConnectionStatus) => void;
  }) {
    this.iceServers = params.iceServers;
    this.sendSignal = params.sendSignal;
    this.getStream = params.getStream;
    this.onPeerStatusChange = params.onPeerStatusChange;
  }

  public async handleViewerRequest(viewerId: string): Promise<void> {
    const stream = this.getStream();
    if (!stream) {
      return;
    }

    this.closePeer(viewerId);
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    this.peers.set(viewerId, pc);
    this.onPeerStatusChange?.(viewerId, 'connecting');

    stream.getTracks().forEach((track) => {
      pc.addTrack(track, stream);
    });

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendSignal({
          type: 'webrtc:ice',
          targetId: viewerId,
          candidate: event.candidate.toJSON(),
        });
      }
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      if (state === 'connected') {
        this.onPeerStatusChange?.(viewerId, 'connected');
      } else if (state === 'disconnected') {
        this.onPeerStatusChange?.(viewerId, 'reconnecting');
      } else if (state === 'failed') {
        this.onPeerStatusChange?.(viewerId, 'failed');
        // Attempt ICE restart once
        try {
          pc.restartIce();
        } catch {
          // Ignore
        }
      }
    };

    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.sendSignal({
        type: 'webrtc:offer',
        targetId: viewerId,
        sdp: offer,
      });
    } catch {
      this.onPeerStatusChange?.(viewerId, 'failed');
    }
  }

  public async handleAnswer(viewerId: string, sdp: RTCSessionDescriptionInit): Promise<void> {
    const pc = this.peers.get(viewerId);
    if (!pc) return;
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      const queued = this.pendingIce.get(viewerId) ?? [];
      this.pendingIce.delete(viewerId);
      for (const cand of queued) {
        await pc.addIceCandidate(new RTCIceCandidate(cand));
      }
    } catch {
      this.onPeerStatusChange?.(viewerId, 'failed');
    }
  }

  public async handleIceCandidate(viewerId: string, candidate: RTCIceCandidateInit): Promise<void> {
    const pc = this.peers.get(viewerId);
    if (!pc || !pc.remoteDescription) {
      const queue = this.pendingIce.get(viewerId) ?? [];
      queue.push(candidate);
      this.pendingIce.set(viewerId, queue);
      return;
    }
    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch {
      // Candidate mismatch on restart
    }
  }

  public closePeer(viewerId: string): void {
    const pc = this.peers.get(viewerId);
    if (pc) {
      pc.onicecandidate = null;
      pc.onconnectionstatechange = null;
      pc.close();
      this.peers.delete(viewerId);
    }
    this.pendingIce.delete(viewerId);
  }

  public dispose(): void {
    for (const id of Array.from(this.peers.keys())) {
      this.closePeer(id);
    }
  }
}

/**
 * Viewer-side WebRTC stream receiver.
 * Receives live video + audio tracks from the Admin without needing to download the file.
 */
export class ViewerWebRtcManager {
  private pc: RTCPeerConnection | null = null;
  private pendingIce: RTCIceCandidateInit[] = [];
  private iceServers: RTCIceServer[];
  private sendSignal: (msg: ClientWsMessage) => void;
  private onRemoteStream: (stream: MediaStream) => void;
  private onStatusChange: (status: PeerConnectionStatus) => void;
  private remoteAdminId: string | null = null;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(params: {
    iceServers: RTCIceServer[];
    sendSignal: (msg: ClientWsMessage) => void;
    onRemoteStream: (stream: MediaStream) => void;
    onStatusChange: (status: PeerConnectionStatus) => void;
  }) {
    this.iceServers = params.iceServers;
    this.sendSignal = params.sendSignal;
    this.onRemoteStream = params.onRemoteStream;
    this.onStatusChange = params.onStatusChange;
  }

  public requestStream(): void {
    this.onStatusChange('connecting');
    this.sendSignal({ type: 'webrtc:request-stream' });
    this.clearTimer();
    this.connectTimer = setTimeout(() => {
      if (!this.pc || this.pc.connectionState !== 'connected') {
        this.onStatusChange('failed');
        this.sendSignal({
          type: 'webrtc:fallback-needed',
          reason: 'Direct peer-to-peer stream timed out (NAT/firewall or unsupported captureStream).',
        });
      }
    }, 15_000);
  }

  public async handleOffer(adminId: string, sdp: RTCSessionDescriptionInit): Promise<void> {
    this.disposePeerOnly();
    this.remoteAdminId = adminId;
    this.onStatusChange('connecting');

    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    this.pc = pc;

    const inboundStream = new MediaStream();

    pc.ontrack = (event) => {
      if (event.streams && event.streams[0]) {
        this.onRemoteStream(event.streams[0]);
      } else {
        inboundStream.addTrack(event.track);
        this.onRemoteStream(inboundStream);
      }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate && this.remoteAdminId) {
        this.sendSignal({
          type: 'webrtc:ice',
          targetId: this.remoteAdminId,
          candidate: event.candidate.toJSON(),
        });
      }
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      if (state === 'connected') {
        this.clearTimer();
        this.onStatusChange('connected');
      } else if (state === 'disconnected') {
        this.onStatusChange('reconnecting');
      } else if (state === 'failed') {
        this.clearTimer();
        this.onStatusChange('failed');
        this.sendSignal({
          type: 'webrtc:fallback-needed',
          reason: 'Direct WebRTC connection failed across networks. Switch to Private Chunked Relay.',
        });
      }
    };

    try {
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      for (const cand of this.pendingIce) {
        await pc.addIceCandidate(new RTCIceCandidate(cand));
      }
      this.pendingIce = [];

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this.sendSignal({
        type: 'webrtc:answer',
        targetId: adminId,
        sdp: answer,
      });
    } catch {
      this.onStatusChange('failed');
    }
  }

  public async handleIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    if (!this.pc || !this.pc.remoteDescription) {
      this.pendingIce.push(candidate);
      return;
    }
    try {
      await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch {
      // Ignore stale candidate
    }
  }

  private clearTimer(): void {
    if (this.connectTimer) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
  }

  private disposePeerOnly(): void {
    if (this.pc) {
      this.pc.ontrack = null;
      this.pc.onicecandidate = null;
      this.pc.onconnectionstatechange = null;
      this.pc.close();
      this.pc = null;
    }
    this.pendingIce = [];
  }

  public dispose(): void {
    this.clearTimer();
    this.disposePeerOnly();
  }
}
