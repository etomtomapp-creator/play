export type ParticipantRole = 'admin' | 'viewer';

export type VideoSourceType = 'none' | 'youtube' | 'gallery';

export type GalleryDeliveryMode = 'webrtc' | 'relay';

export interface Participant {
  id: string;
  displayName: string;
  avatar: string;
  role: ParticipantRole;
  online: boolean;
  joinedAt: number;
  firebaseUid?: string | null;
}

export interface VideoState {
  source: VideoSourceType;
  youtubeId?: string;
  title?: string;
  thumbnailUrl?: string;
  fileName?: string;
  fileSize?: number;
  duration?: number;
  mimeType?: string;
  deliveryMode?: GalleryDeliveryMode;
  mediaId?: string;
  streamUrl?: string;
  addedAt?: number;
}

export interface PlaybackState {
  playing: boolean;
  position: number; // seconds at updatedAtServerMs
  rate: number;
  updatedAtServerMs: number;
}

export interface RoomSettings {
  title: string;
  chatEnabled: boolean;
  isLocked: boolean;
  maxParticipants: number;
}

export interface ChatReaction {
  emoji: string;
  userIds: string[];
}

export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  senderAvatar: string;
  senderRole: ParticipantRole;
  text: string;
  timestamp: number;
  reactions: Record<string, string[]>; // emoji -> participantIds
  clientMessageId?: string;
}

export interface RoomState {
  roomId: string;
  adminId: string;
  adminOnline: boolean;
  status: 'active' | 'ended';
  createdAt: number;
  expiresAt: number;
  settings: RoomSettings;
  video: VideoState;
  playback: PlaybackState;
  participants: Participant[];
  messages: ChatMessage[];
}

export interface RoomPreview {
  roomId: string;
  title: string;
  adminName: string;
  adminAvatar: string;
  participantCount: number;
  maxParticipants: number;
  isLocked: boolean;
  status: 'active' | 'ended';
  videoSource: VideoSourceType;
  videoTitle?: string;
  createdAt: number;
}

export interface RtcConfigResponse {
  iceServers: RTCIceServer[];
  hasTurn: boolean;
}

export interface UserProfileData {
  displayName: string;
  avatar: string;
  firebaseUid?: string | null;
  email?: string | null;
  isAuthenticated: boolean;
}

export type PlaybackCommandAction = 'play' | 'pause' | 'seek' | 'rate' | 'heartbeat';

export type ClientWsMessage =
  | { type: 'auth'; roomId: string; token: string }
  | { type: 'ping'; clientTime: number }
  | { type: 'profile:update'; displayName: string; avatar: string }
  | { type: 'chat:send'; text: string; clientMessageId: string }
  | { type: 'chat:react'; messageId: string; emoji: string }
  | { type: 'video:set'; video: VideoState }
  | { type: 'video:remove' }
  | {
      type: 'playback:command';
      action: PlaybackCommandAction;
      position: number;
      playing: boolean;
      rate?: number;
    }
  | { type: 'room:settings'; settings: Partial<RoomSettings> }
  | { type: 'room:kick'; targetParticipantId: string }
  | { type: 'room:end' }
  | { type: 'webrtc:request-stream' }
  | { type: 'webrtc:offer'; targetId: string; sdp: RTCSessionDescriptionInit }
  | { type: 'webrtc:answer'; targetId: string; sdp: RTCSessionDescriptionInit }
  | { type: 'webrtc:ice'; targetId: string; candidate: RTCIceCandidateInit }
  | { type: 'webrtc:fallback-needed'; reason: string };

export type ServerWsMessage =
  | { type: 'auth:ok'; room: RoomState; selfId: string; role: ParticipantRole; serverTime: number }
  | { type: 'pong'; clientTime: number; serverTime: number }
  | { type: 'room:state'; room: RoomState; serverTime: number }
  | { type: 'participants:update'; participants: Participant[]; adminOnline: boolean }
  | { type: 'playback:sync'; playback: PlaybackState; serverTime: number; reason: PlaybackCommandAction }
  | { type: 'video:update'; video: VideoState; playback: PlaybackState; serverTime: number }
  | { type: 'settings:update'; settings: RoomSettings }
  | { type: 'chat:message'; message: ChatMessage }
  | { type: 'chat:ack'; clientMessageId: string; messageId: string }
  | { type: 'chat:reaction'; messageId: string; reactions: Record<string, string[]> }
  | { type: 'room:kicked'; reason: string }
  | { type: 'room:ended'; reason: string }
  | { type: 'error'; code: string; message: string }
  | { type: 'webrtc:request-stream'; fromId: string }
  | { type: 'webrtc:offer'; fromId: string; sdp: RTCSessionDescriptionInit }
  | { type: 'webrtc:answer'; fromId: string; sdp: RTCSessionDescriptionInit }
  | { type: 'webrtc:ice'; fromId: string; candidate: RTCIceCandidateInit }
  | { type: 'webrtc:fallback-needed'; fromId: string; reason: string };
