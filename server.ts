import crypto from 'crypto';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import express, { type Request, type Response, type NextFunction } from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import type {
  ChatMessage,
  ClientWsMessage,
  Participant,
  ParticipantRole,
  PlaybackCommandAction,
  PlaybackState,
  RoomPreview,
  RoomSettings,
  RoomState,
  ServerWsMessage,
  VideoState,
} from './src/shared/types.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const SESSION_SECRET =
  process.env.SYNCWATCH_SESSION_SECRET && process.env.SYNCWATCH_SESSION_SECRET.length >= 16
    ? process.env.SYNCWATCH_SESSION_SECRET
    : crypto.randomBytes(32).toString('hex');

const MEDIA_ROOT = path.resolve(os.tmpdir(), 'syncwatch-media');
fs.mkdirSync(MEDIA_ROOT, { recursive: true });

const ROOM_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const ADMIN_DISCONNECT_GRACE_MS = 20 * 60 * 1000; // 20 minutes grace period while preserving state
const CHUNK_SIZE_BYTES = 2 * 1024 * 1024; // 2MB chunks
const MAX_MESSAGES_PER_ROOM = 300;
const ROOM_ID_REGEX = /^SW-[A-Z0-9]{5}$/;
const SAFE_ID_REGEX = /^[a-zA-Z0-9_-]{4,64}$/;
const YOUTUBE_ID_REGEX = /^[a-zA-Z0-9_-]{11}$/;
const ALLOWED_VIDEO_MIMES = new Set([
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/ogg',
  'video/x-matroska',
  'video/mp2t',
  'application/octet-stream',
]);

interface MediaUploadSession {
  uploadId: string;
  roomId: string;
  adminId: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  duration: number;
  thumbnailUrl?: string;
  filePath: string;
  receivedBytes: number;
  createdAt: number;
}

interface StoredMediaFile {
  mediaId: string;
  roomId: string;
  filePath: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  createdAt: number;
}

interface InternalRoom {
  roomId: string;
  adminId: string;
  adminOnline: boolean;
  adminDisconnectedAt: number | null;
  status: 'active' | 'ended';
  createdAt: number;
  expiresAt: number;
  settings: RoomSettings;
  video: VideoState;
  playback: PlaybackState;
  participants: Map<string, Participant>;
  sockets: Map<string, WebSocket>;
  messages: ChatMessage[];
  mediaFiles: Map<string, StoredMediaFile>;
  uploads: Map<string, MediaUploadSession>;
}

interface TokenPayload {
  roomId: string;
  participantId: string;
  role: ParticipantRole;
  exp: number;
}

interface MediaTokenPayload {
  roomId: string;
  mediaId: string;
  exp: number;
}

const rooms = new Map<string, InternalRoom>();

function base64UrlEncode(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64url');
}

function base64UrlDecode(input: string): string {
  return Buffer.from(input, 'base64url').toString('utf8');
}

function signPayload(payload: object): string {
  const encoded = base64UrlEncode(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

function verifyToken<T>(token: string | undefined | null): T | null {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  const expectedSig = crypto.createHmac('sha256', SESSION_SECRET).update(encoded).digest('base64url');
  const sigBuf = Buffer.from(sig, 'utf8');
  const expBuf = Buffer.from(expectedSig, 'utf8');
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }
  try {
    const parsed = JSON.parse(base64UrlDecode(encoded)) as T & { exp?: number };
    if (typeof parsed.exp === 'number' && Date.now() > parsed.exp) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function generateRoomId(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let attempt = 0; attempt < 25; attempt++) {
    const bytes = crypto.randomBytes(5);
    let code = 'SW-';
    for (let i = 0; i < 5; i++) {
      code += chars[bytes[i] % chars.length];
    }
    if (!rooms.has(code)) return code;
  }
  return `SW-${crypto.randomBytes(3).toString('hex').toUpperCase().slice(0, 5)}`;
}

function generateId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

function sanitizeDisplayName(raw: unknown, fallback = 'Guest'): string {
  if (typeof raw !== 'string') return fallback;
  const trimmed = raw.trim().replace(/\s+/g, ' ').slice(0, 40);
  return trimmed.length > 0 ? trimmed : fallback;
}

function sanitizeAvatar(raw: unknown): string {
  if (typeof raw !== 'string') return 'cosmic';
  const trimmed = raw.trim().slice(0, 256);
  if (!trimmed) return 'cosmic';
  // Block javascript:/data: injection in avatar URLs
  if (/^(javascript|vbscript|data):/i.test(trimmed)) return 'cosmic';
  return trimmed;
}

function sanitizeRoomTitle(raw: unknown): string {
  if (typeof raw !== 'string') return 'Private Watch Room';
  const trimmed = raw.trim().replace(/\s+/g, ' ').slice(0, 80);
  return trimmed.length > 0 ? trimmed : 'Private Watch Room';
}

function sanitizeFileName(raw: unknown): string {
  if (typeof raw !== 'string') return 'video.mp4';
  const base = path.basename(raw).replace(/[^a-zA-Z0-9._\- ()[\]]/g, '_').slice(0, 120);
  return base.length > 0 ? base : 'video.mp4';
}

function computeLivePosition(playback: PlaybackState, nowMs = Date.now()): number {
  if (!playback.playing) return Math.max(0, playback.position);
  const elapsedSec = Math.max(0, (nowMs - playback.updatedAtServerMs) / 1000);
  return Math.max(0, playback.position + elapsedSec * playback.rate);
}

function serializeRoom(room: InternalRoom): RoomState {
  const now = Date.now();
  return {
    roomId: room.roomId,
    adminId: room.adminId,
    adminOnline: room.adminOnline,
    status: room.status,
    createdAt: room.createdAt,
    expiresAt: room.expiresAt,
    settings: { ...room.settings },
    video: { ...room.video },
    playback: {
      ...room.playback,
      position: computeLivePosition(room.playback, now),
      updatedAtServerMs: now,
    },
    participants: Array.from(room.participants.values()),
    messages: room.messages.slice(-MAX_MESSAGES_PER_ROOM),
  };
}

function sendWs(ws: WebSocket | undefined, msg: ServerWsMessage): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  try {
    ws.send(JSON.stringify(msg));
  } catch {
    // Socket closed mid-send
  }
}

function broadcastRoom(room: InternalRoom, msg: ServerWsMessage, excludeId?: string): void {
  const encoded = JSON.stringify(msg);
  for (const [pid, sock] of room.sockets.entries()) {
    if (excludeId && pid === excludeId) continue;
    if (sock.readyState === WebSocket.OPEN) {
      try {
        sock.send(encoded);
      } catch {
        // Ignore broken pipe
      }
    }
  }
}

function safeResolveMediaPath(roomId: string, fileName: string): string | null {
  if (!ROOM_ID_REGEX.test(roomId) || !SAFE_ID_REGEX.test(fileName.replace(/\.bin$/, ''))) {
    return null;
  }
  const roomDir = path.resolve(MEDIA_ROOT, roomId);
  const target = path.resolve(roomDir, fileName);
  if (!roomDir.startsWith(MEDIA_ROOT + path.sep)) return null;
  if (!target.startsWith(roomDir + path.sep)) return null;
  return target;
}

function cleanupRoomMedia(room: InternalRoom): void {
  room.mediaFiles.clear();
  room.uploads.clear();
  if (!ROOM_ID_REGEX.test(room.roomId)) return;
  const roomDir = path.resolve(MEDIA_ROOT, room.roomId);
  if (roomDir.startsWith(MEDIA_ROOT + path.sep)) {
    fs.rm(roomDir, { recursive: true, force: true }, () => {
      // Best-effort temp cleanup
    });
  }
}

function cleanupSingleMedia(filePath: string): void {
  const resolved = path.resolve(filePath);
  if (resolved.startsWith(MEDIA_ROOT + path.sep)) {
    fs.unlink(resolved, () => {
      // Ignore missing file
    });
  }
}

function endRoomAndNotify(room: InternalRoom, reason: string): void {
  if (room.status === 'ended') return;
  room.status = 'ended';
  room.playback = {
    playing: false,
    position: computeLivePosition(room.playback),
    rate: room.playback.rate,
    updatedAtServerMs: Date.now(),
  };
  broadcastRoom(room, { type: 'room:ended', reason });
  for (const sock of room.sockets.values()) {
    try {
      sock.close(1000, reason);
    } catch {
      // Ignore
    }
  }
  room.sockets.clear();
  cleanupRoomMedia(room);
}

// Periodic expiration & orphan media cleanup
setInterval(() => {
  const now = Date.now();
  for (const [roomId, room] of rooms.entries()) {
    const expiredByTtl = now > room.expiresAt;
    const expiredByAdminAbsence =
      !room.adminOnline &&
      room.adminDisconnectedAt !== null &&
      now - room.adminDisconnectedAt > ADMIN_DISCONNECT_GRACE_MS;

    if (room.status === 'active' && (expiredByTtl || expiredByAdminAbsence)) {
      endRoomAndNotify(
        room,
        expiredByTtl ? 'This room has expired.' : 'The room closed because the Admin did not reconnect.'
      );
    }

    // Purge ended rooms from memory 15 minutes after ending
    if (room.status === 'ended' && now > room.expiresAt + 15 * 60 * 1000) {
      cleanupRoomMedia(room);
      rooms.delete(roomId);
    }
  }
}, 60_000);

function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  return authHeader.slice(7).trim();
}

function requireRoomAuth(
  req: Request,
  res: Response,
  next: NextFunction,
  requireAdmin = false
): void {
  const token = extractBearerToken(req);
  const payload = verifyToken<TokenPayload>(token);
  if (!payload) {
    res.status(401).json({ code: 'UNAUTHORIZED', message: 'Invalid or expired room session token.' });
    return;
  }

  const roomIdParam = req.params.roomId;
  if (roomIdParam && roomIdParam !== payload.roomId) {
    res.status(403).json({ code: 'ROOM_MISMATCH', message: 'Token does not grant access to this room.' });
    return;
  }

  const room = rooms.get(payload.roomId);
  if (!room) {
    res.status(404).json({ code: 'ROOM_NOT_FOUND', message: 'This room no longer exists.' });
    return;
  }

  if (room.status === 'ended' || Date.now() > room.expiresAt) {
    res.status(410).json({ code: 'ROOM_EXPIRED', message: 'This room has ended or expired.' });
    return;
  }

  const participant = room.participants.get(payload.participantId);
  if (!participant) {
    res.status(403).json({ code: 'NOT_A_MEMBER', message: 'You are no longer a participant in this room.' });
    return;
  }

  if (requireAdmin && (room.adminId !== participant.id || participant.role !== 'admin')) {
    res.status(403).json({
      code: 'ADMIN_ONLY',
      message: 'Viewer Mode — Only the room Admin can control the video or room settings.',
    });
    return;
  }

  res.locals.roomAuth = {
    room,
    participant,
  };
  next();
}

async function startServer() {
  const app = express();
  app.set('trust proxy', 1);

  // Raw binary body parser exclusively for chunked media upload endpoint
  app.use(
    '/api/rooms/:roomId/media/:uploadId/chunk',
    express.raw({ type: 'application/octet-stream', limit: '4mb' })
  );
  app.use(express.json({ limit: '512kb' }));

  // --- Health check ---
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', activeRooms: rooms.size, timestamp: Date.now() });
  });

  // --- WebRTC ICE Configuration (STUN + optional server-side TURN) ---
  app.get('/api/rtc-config', (req, res, next) => requireRoomAuth(req, res, next, false), (_req, res) => {
    const iceServers: RTCIceServer[] = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
    ];

    const turnUrl = process.env.TURN_URL?.trim();
    const turnUser = process.env.TURN_USERNAME?.trim();
    const turnCred = process.env.TURN_CREDENTIAL?.trim();
    let hasTurn = false;

    if (turnUrl && turnUser && turnCred) {
      iceServers.push({
        urls: turnUrl,
        username: turnUser,
        credential: turnCred,
      });
      hasTurn = true;
    }

    res.json({ iceServers, hasTurn });
  });

  // --- Create Room (Generate Team -> Creator becomes sole Admin) ---
  app.post('/api/rooms', (req, res) => {
    const { displayName, avatar, title, maxParticipants, firebaseUid } = req.body ?? {};
    const safeName = sanitizeDisplayName(displayName, 'Host');
    const safeAvatar = sanitizeAvatar(avatar);
    const safeTitle = sanitizeRoomTitle(title);
    const safeCap = Math.min(8, Math.max(2, Number.isFinite(Number(maxParticipants)) ? Math.round(Number(maxParticipants)) : 2));

    const roomId = generateRoomId();
    const adminId = generateId('adm');
    const now = Date.now();

    const adminParticipant: Participant = {
      id: adminId,
      displayName: safeName,
      avatar: safeAvatar,
      role: 'admin',
      online: true,
      joinedAt: now,
      firebaseUid: typeof firebaseUid === 'string' ? firebaseUid.slice(0, 128) : null,
    };

    const room: InternalRoom = {
      roomId,
      adminId,
      adminOnline: true,
      adminDisconnectedAt: null,
      status: 'active',
      createdAt: now,
      expiresAt: now + ROOM_TTL_MS,
      settings: {
        title: safeTitle,
        chatEnabled: true,
        isLocked: false,
        maxParticipants: safeCap,
      },
      video: { source: 'none' },
      playback: {
        playing: false,
        position: 0,
        rate: 1,
        updatedAtServerMs: now,
      },
      participants: new Map([[adminId, adminParticipant]]),
      sockets: new Map(),
      messages: [],
      mediaFiles: new Map(),
      uploads: new Map(),
    };

    rooms.set(roomId, room);

    const token = signPayload({
      roomId,
      participantId: adminId,
      role: 'admin',
      exp: room.expiresAt,
    } satisfies TokenPayload);

    res.status(201).json({
      room: serializeRoom(room),
      participantId: adminId,
      role: 'admin',
      token,
      invitePath: `/join/${roomId}`,
    });
  });

  // --- Room Preview (Before Joining) ---
  app.get('/api/rooms/:roomId/preview', (req, res) => {
    const normalizedId = String(req.params.roomId || '').trim().toUpperCase();
    if (!ROOM_ID_REGEX.test(normalizedId)) {
      res.status(400).json({
        code: 'INVALID_ROOM_ID',
        message: 'Room ID format is invalid. Expected format like SW-7F3D9.',
      });
      return;
    }

    const room = rooms.get(normalizedId);
    if (!room) {
      res.status(404).json({
        code: 'ROOM_NOT_FOUND',
        message: 'Room not found. Double-check the Room ID or ask your friend for a fresh invite link.',
      });
      return;
    }

    if (room.status === 'ended') {
      res.status(410).json({
        code: 'ROOM_ENDED',
        message: 'This watch party has already been ended by the Admin.',
      });
      return;
    }

    if (Date.now() > room.expiresAt) {
      endRoomAndNotify(room, 'This room has expired.');
      res.status(410).json({
        code: 'ROOM_EXPIRED',
        message: 'This room has expired. Ask your friend to generate a new team.',
      });
      return;
    }

    const admin = room.participants.get(room.adminId);
    const preview: RoomPreview = {
      roomId: room.roomId,
      title: room.settings.title,
      adminName: admin?.displayName ?? 'Room Admin',
      adminAvatar: admin?.avatar ?? 'cosmic',
      participantCount: room.participants.size,
      maxParticipants: room.settings.maxParticipants,
      isLocked: room.settings.isLocked,
      status: room.status,
      videoSource: room.video.source,
      videoTitle: room.video.title,
      createdAt: room.createdAt,
    };

    res.json({ preview });
  });

  // --- Join Room (Viewer Role Only) ---
  app.post('/api/rooms/:roomId/join', (req, res) => {
    const normalizedId = String(req.params.roomId || '').trim().toUpperCase();
    if (!ROOM_ID_REGEX.test(normalizedId)) {
      res.status(400).json({
        code: 'INVALID_ROOM_ID',
        message: 'Please enter a valid Room ID (example: SW-7F3D9).',
      });
      return;
    }

    const room = rooms.get(normalizedId);
    if (!room) {
      res.status(404).json({
        code: 'ROOM_NOT_FOUND',
        message: 'No active room matches that Room ID.',
      });
      return;
    }

    if (room.status === 'ended') {
      res.status(410).json({
        code: 'ROOM_ENDED',
        message: 'This room was ended by the Admin.',
      });
      return;
    }

    if (Date.now() > room.expiresAt) {
      endRoomAndNotify(room, 'This room has expired.');
      res.status(410).json({
        code: 'ROOM_EXPIRED',
        message: 'This room has expired.',
      });
      return;
    }

    if (room.settings.isLocked) {
      res.status(403).json({
        code: 'ROOM_LOCKED',
        message: 'This private room is currently locked by the Admin.',
      });
      return;
    }

    if (room.participants.size >= room.settings.maxParticipants) {
      res.status(409).json({
        code: 'ROOM_FULL',
        message: `This room is full (${room.participants.size}/${room.settings.maxParticipants} participants).`,
      });
      return;
    }

    const { displayName, avatar, firebaseUid } = req.body ?? {};
    const viewerId = generateId('vwr');
    const now = Date.now();

    const viewer: Participant = {
      id: viewerId,
      displayName: sanitizeDisplayName(displayName, 'Friend'),
      avatar: sanitizeAvatar(avatar),
      role: 'viewer',
      online: true,
      joinedAt: now,
      firebaseUid: typeof firebaseUid === 'string' ? firebaseUid.slice(0, 128) : null,
    };

    room.participants.set(viewerId, viewer);

    const token = signPayload({
      roomId: room.roomId,
      participantId: viewerId,
      role: 'viewer',
      exp: room.expiresAt,
    } satisfies TokenPayload);

    broadcastRoom(room, {
      type: 'participants:update',
      participants: Array.from(room.participants.values()),
      adminOnline: room.adminOnline,
    });

    res.status(200).json({
      room: serializeRoom(room),
      participantId: viewerId,
      role: 'viewer',
      token,
    });
  });

  // --- Resumable Chunked Gallery Upload Fallback (Admin-Only) ---
  app.post(
    '/api/rooms/:roomId/media/init',
    (req, res, next) => requireRoomAuth(req, res, next, true),
    (req, res) => {
      const { room, participant } = res.locals.roomAuth as {
        room: InternalRoom;
        participant: Participant;
      };

      const { fileName, fileSize, mimeType, duration, thumbnailUrl } = req.body ?? {};
      const parsedSize = Number(fileSize);
      if (!Number.isFinite(parsedSize) || parsedSize <= 0) {
        res.status(400).json({ code: 'INVALID_FILE', message: 'Invalid video file size.' });
        return;
      }

      // Guard container ephemeral disk ceiling (~1.5 GB relay limit; direct WebRTC has no server storage limit)
      const MAX_RELAY_BYTES = 1536 * 1024 * 1024;
      if (parsedSize > MAX_RELAY_BYTES) {
        res.status(413).json({
          code: 'RELAY_LIMIT_EXCEEDED',
          message:
            'This file exceeds the 1.5 GB temporary cloud relay ceiling. Use Direct WebRTC Peer Stream for larger local movies.',
        });
        return;
      }

      const normalizedMime =
        typeof mimeType === 'string' && ALLOWED_VIDEO_MIMES.has(mimeType.toLowerCase())
          ? mimeType.toLowerCase()
          : 'video/mp4';

      const uploadId = generateId('upl');
      const filePath = safeResolveMediaPath(room.roomId, `${uploadId}.bin`);
      if (!filePath) {
        res.status(400).json({ code: 'INVALID_PATH', message: 'Unable to initialize secure media path.' });
        return;
      }

      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, Buffer.alloc(0));

      const session: MediaUploadSession = {
        uploadId,
        roomId: room.roomId,
        adminId: participant.id,
        fileName: sanitizeFileName(fileName),
        fileSize: parsedSize,
        mimeType: normalizedMime,
        duration: Number.isFinite(Number(duration)) ? Math.max(0, Number(duration)) : 0,
        thumbnailUrl:
          typeof thumbnailUrl === 'string' && thumbnailUrl.startsWith('data:image/') && thumbnailUrl.length < 220_000
            ? thumbnailUrl
            : undefined,
        filePath,
        receivedBytes: 0,
        createdAt: Date.now(),
      };

      room.uploads.set(uploadId, session);
      res.status(201).json({
        uploadId,
        chunkSize: CHUNK_SIZE_BYTES,
      });
    }
  );

  app.put(
    '/api/rooms/:roomId/media/:uploadId/chunk',
    (req, res, next) => requireRoomAuth(req, res, next, true),
    async (req, res) => {
      const { room } = res.locals.roomAuth as {
        room: InternalRoom;
        participant: Participant;
      };
      const uploadId = String(req.params.uploadId || '');
      const session = room.uploads.get(uploadId);

      if (!session) {
        res.status(404).json({ code: 'UPLOAD_NOT_FOUND', message: 'Upload session not found or canceled.' });
        return;
      }

      const chunkBuf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      const offset = Number(req.headers['x-chunk-offset'] ?? session.receivedBytes);

      if (!Number.isFinite(offset) || offset < 0 || offset + chunkBuf.length > session.fileSize + 1024) {
        res.status(400).json({ code: 'INVALID_OFFSET', message: 'Chunk offset out of bounds.' });
        return;
      }

      try {
        const handle = await fs.promises.open(session.filePath, 'r+');
        try {
          await handle.write(chunkBuf, 0, chunkBuf.length, offset);
        } finally {
          await handle.close();
        }
        session.receivedBytes = Math.max(session.receivedBytes, offset + chunkBuf.length);
        res.json({
          receivedBytes: session.receivedBytes,
          totalBytes: session.fileSize,
        });
      } catch {
        res.status(500).json({ code: 'CHUNK_WRITE_FAILED', message: 'Failed to store video chunk.' });
      }
    }
  );

  app.post(
    '/api/rooms/:roomId/media/:uploadId/complete',
    (req, res, next) => requireRoomAuth(req, res, next, true),
    (req, res) => {
      const { room } = res.locals.roomAuth as {
        room: InternalRoom;
        participant: Participant;
      };
      const uploadId = String(req.params.uploadId || '');
      const session = room.uploads.get(uploadId);

      if (!session) {
        res.status(404).json({ code: 'UPLOAD_NOT_FOUND', message: 'Upload session not found.' });
        return;
      }

      // Clean up any previous relay media file in this room
      for (const oldFile of room.mediaFiles.values()) {
        cleanupSingleMedia(oldFile.filePath);
      }
      room.mediaFiles.clear();

      const mediaId = generateId('med');
      const stored: StoredMediaFile = {
        mediaId,
        roomId: room.roomId,
        filePath: session.filePath,
        fileName: session.fileName,
        fileSize: session.receivedBytes || session.fileSize,
        mimeType: session.mimeType,
        createdAt: Date.now(),
      };

      room.mediaFiles.set(mediaId, stored);
      room.uploads.delete(uploadId);

      const streamToken = signPayload({
        roomId: room.roomId,
        mediaId,
        exp: room.expiresAt,
      } satisfies MediaTokenPayload);

      const streamUrl = `/api/rooms/${encodeURIComponent(room.roomId)}/media/${encodeURIComponent(mediaId)}/stream?token=${encodeURIComponent(streamToken)}`;

      const now = Date.now();
      room.video = {
        source: 'gallery',
        title: session.fileName,
        fileName: session.fileName,
        fileSize: stored.fileSize,
        duration: session.duration,
        mimeType: stored.mimeType,
        thumbnailUrl: session.thumbnailUrl,
        deliveryMode: 'relay',
        mediaId,
        streamUrl,
        addedAt: now,
      };
      room.playback = {
        playing: false,
        position: 0,
        rate: 1,
        updatedAtServerMs: now,
      };

      broadcastRoom(room, {
        type: 'video:update',
        video: room.video,
        playback: room.playback,
        serverTime: now,
      });

      res.json({
        mediaId,
        streamUrl,
        video: room.video,
      });
    }
  );

  // --- Private Signed HTTP 206 Partial Content Media Stream ---
  app.get('/api/rooms/:roomId/media/:mediaId/stream', (req, res) => {
    const token = typeof req.query.token === 'string' ? req.query.token : extractBearerToken(req);
    const payload = verifyToken<MediaTokenPayload>(token);
    const roomId = String(req.params.roomId || '');
    const mediaId = String(req.params.mediaId || '');

    if (!payload || payload.roomId !== roomId || payload.mediaId !== mediaId) {
      res.status(403).json({ code: 'FORBIDDEN', message: 'Private media stream requires a valid room token.' });
      return;
    }

    const room = rooms.get(roomId);
    if (!room || room.status === 'ended' || Date.now() > room.expiresAt) {
      res.status(410).json({ code: 'MEDIA_EXPIRED', message: 'This media stream has expired.' });
      return;
    }

    const stored = room.mediaFiles.get(mediaId);
    if (!stored || !fs.existsSync(stored.filePath)) {
      res.status(404).json({ code: 'MEDIA_NOT_FOUND', message: 'Media file is no longer available.' });
      return;
    }

    const stat = fs.statSync(stored.filePath);
    const total = stat.size;
    const range = req.headers.range;

    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Type', stored.mimeType);

    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match) {
        res.status(416).setHeader('Content-Range', `bytes */${total}`).end();
        return;
      }
      const start = match[1] ? parseInt(match[1], 10) : 0;
      const end = match[2] ? Math.min(parseInt(match[2], 10), total - 1) : Math.min(start + 4 * 1024 * 1024 - 1, total - 1);
      if (start >= total || start > end) {
        res.status(416).setHeader('Content-Range', `bytes */${total}`).end();
        return;
      }

      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
      res.setHeader('Content-Length', end - start + 1);
      const stream = fs.createReadStream(stored.filePath, { start, end });
      stream.pipe(res);
    } else {
      res.status(200);
      res.setHeader('Content-Length', total);
      const stream = fs.createReadStream(stored.filePath);
      stream.pipe(res);
    }
  });

  // --- Vite Dev Middleware / Production Static Serving ---
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws: WebSocket) => {
    let authedRoom: InternalRoom | null = null;
    let authedParticipant: Participant | null = null;

    const authTimeout = setTimeout(() => {
      if (!authedRoom) {
        sendWs(ws, { type: 'error', code: 'AUTH_TIMEOUT', message: 'Authentication timed out.' });
        ws.close(4001, 'Auth timeout');
      }
    }, 10_000);

    ws.on('message', (rawData) => {
      let msg: ClientWsMessage;
      try {
        const str = typeof rawData === 'string' ? rawData : rawData.toString('utf8');
        if (str.length > 262_144) {
          sendWs(ws, { type: 'error', code: 'PAYLOAD_TOO_LARGE', message: 'Message exceeds maximum size.' });
          return;
        }
        msg = JSON.parse(str) as ClientWsMessage;
      } catch {
        sendWs(ws, { type: 'error', code: 'INVALID_JSON', message: 'Malformed socket message.' });
        return;
      }

      if (msg.type === 'ping') {
        sendWs(ws, { type: 'pong', clientTime: msg.clientTime, serverTime: Date.now() });
        return;
      }

      if (msg.type === 'auth') {
        const payload = verifyToken<TokenPayload>(msg.token);
        if (!payload || payload.roomId !== msg.roomId) {
          sendWs(ws, { type: 'error', code: 'AUTH_FAILED', message: 'Invalid or expired room session.' });
          ws.close(4003, 'Unauthorized');
          return;
        }

        const room = rooms.get(payload.roomId);
        if (!room) {
          sendWs(ws, { type: 'error', code: 'ROOM_NOT_FOUND', message: 'This room no longer exists.' });
          ws.close(4004, 'Room not found');
          return;
        }

        if (room.status === 'ended' || Date.now() > room.expiresAt) {
          sendWs(ws, { type: 'room:ended', reason: 'This room has ended or expired.' });
          ws.close(4010, 'Room ended');
          return;
        }

        const participant = room.participants.get(payload.participantId);
        if (!participant) {
          sendWs(ws, { type: 'room:kicked', reason: 'You are no longer in this room.' });
          ws.close(4003, 'Not a member');
          return;
        }

        clearTimeout(authTimeout);
        authedRoom = room;
        authedParticipant = participant;

        // Replace any stale socket for this participant
        const prevSock = room.sockets.get(participant.id);
        if (prevSock && prevSock !== ws && prevSock.readyState === WebSocket.OPEN) {
          prevSock.close(4009, 'Reconnected from another tab');
        }

        room.sockets.set(participant.id, ws);
        participant.online = true;

        if (participant.id === room.adminId) {
          room.adminOnline = true;
          room.adminDisconnectedAt = null;
        }

        sendWs(ws, {
          type: 'auth:ok',
          room: serializeRoom(room),
          selfId: participant.id,
          role: participant.role,
          serverTime: Date.now(),
        });

        broadcastRoom(
          room,
          {
            type: 'participants:update',
            participants: Array.from(room.participants.values()),
            adminOnline: room.adminOnline,
          },
          participant.id
        );
        return;
      }

      // All other messages require an authenticated room session
      if (!authedRoom || !authedParticipant) {
        sendWs(ws, { type: 'error', code: 'NOT_AUTHENTICATED', message: 'Authenticate before sending events.' });
        return;
      }

      const room = authedRoom;
      const participant = authedParticipant;

      if (room.status === 'ended') {
        sendWs(ws, { type: 'room:ended', reason: 'This room has already ended.' });
        return;
      }

      const isVerifiedAdmin = participant.role === 'admin' && room.adminId === participant.id;

      switch (msg.type) {
        case 'profile:update': {
          participant.displayName = sanitizeDisplayName(msg.displayName, participant.displayName);
          participant.avatar = sanitizeAvatar(msg.avatar);
          broadcastRoom(room, {
            type: 'participants:update',
            participants: Array.from(room.participants.values()),
            adminOnline: room.adminOnline,
          });
          break;
        }

        case 'chat:send': {
          if (!room.settings.chatEnabled && !isVerifiedAdmin) {
            sendWs(ws, {
              type: 'error',
              code: 'CHAT_DISABLED',
              message: 'Chat is currently disabled by the room Admin.',
            });
            return;
          }
          const cleanText = typeof msg.text === 'string' ? msg.text.trim().slice(0, 600) : '';
          if (!cleanText) return;

          const chatMsg: ChatMessage = {
            id: generateId('msg'),
            senderId: participant.id,
            senderName: participant.displayName,
            senderAvatar: participant.avatar,
            senderRole: participant.role,
            text: cleanText,
            timestamp: Date.now(),
            reactions: {},
            clientMessageId: typeof msg.clientMessageId === 'string' ? msg.clientMessageId.slice(0, 64) : undefined,
          };

          room.messages.push(chatMsg);
          if (room.messages.length > MAX_MESSAGES_PER_ROOM) {
            room.messages.splice(0, room.messages.length - MAX_MESSAGES_PER_ROOM);
          }

          sendWs(ws, {
            type: 'chat:ack',
            clientMessageId: chatMsg.clientMessageId ?? chatMsg.id,
            messageId: chatMsg.id,
          });
          broadcastRoom(room, { type: 'chat:message', message: chatMsg });
          break;
        }

        case 'chat:react': {
          const emoji = typeof msg.emoji === 'string' ? msg.emoji.trim().slice(0, 8) : '';
          if (!emoji) return;
          const target = room.messages.find((m) => m.id === msg.messageId);
          if (!target) return;

          const existingReactors = target.reactions[emoji] ?? [];
          if (existingReactors.includes(participant.id)) {
            const next = existingReactors.filter((id) => id !== participant.id);
            if (next.length === 0) {
              delete target.reactions[emoji];
            } else {
              target.reactions[emoji] = next;
            }
          } else {
            if (Object.keys(target.reactions).length >= 12 && !target.reactions[emoji]) {
              return;
            }
            target.reactions[emoji] = [...existingReactors, participant.id];
          }

          broadcastRoom(room, {
            type: 'chat:reaction',
            messageId: target.id,
            reactions: { ...target.reactions },
          });
          break;
        }

        // --- STRICT SERVER-SIDE ADMIN ENFORCEMENT ---
        case 'video:set': {
          if (!isVerifiedAdmin) {
            sendWs(ws, {
              type: 'error',
              code: 'UNAUTHORIZED_ADMIN_ACTION',
              message: 'Viewer Mode — Only the room Admin can add or change the video.',
            });
            return;
          }

          const incoming = msg.video;
          if (!incoming || (incoming.source !== 'youtube' && incoming.source !== 'gallery')) {
            sendWs(ws, {
              type: 'error',
              code: 'INVALID_SOURCE',
              message: 'Only YouTube and Gallery video sources are supported.',
            });
            return;
          }

          const now = Date.now();
          if (incoming.source === 'youtube') {
            if (!incoming.youtubeId || !YOUTUBE_ID_REGEX.test(incoming.youtubeId)) {
              sendWs(ws, { type: 'error', code: 'INVALID_YOUTUBE_ID', message: 'Invalid YouTube video ID.' });
              return;
            }
            // Clear any old gallery relay files
            for (const oldFile of room.mediaFiles.values()) {
              cleanupSingleMedia(oldFile.filePath);
            }
            room.mediaFiles.clear();

            room.video = {
              source: 'youtube',
              youtubeId: incoming.youtubeId,
              title: typeof incoming.title === 'string' ? incoming.title.slice(0, 160) : 'YouTube Video',
              thumbnailUrl: `https://i.ytimg.com/vi/${incoming.youtubeId}/hqdefault.jpg`,
              addedAt: now,
            };
          } else {
            // Gallery mode (WebRTC direct stream)
            room.video = {
              source: 'gallery',
              title: sanitizeFileName(incoming.fileName || incoming.title),
              fileName: sanitizeFileName(incoming.fileName || incoming.title),
              fileSize: Number.isFinite(Number(incoming.fileSize)) ? Math.max(0, Number(incoming.fileSize)) : 0,
              duration: Number.isFinite(Number(incoming.duration)) ? Math.max(0, Number(incoming.duration)) : 0,
              mimeType: typeof incoming.mimeType === 'string' ? incoming.mimeType.slice(0, 64) : 'video/mp4',
              thumbnailUrl:
                typeof incoming.thumbnailUrl === 'string' &&
                incoming.thumbnailUrl.startsWith('data:image/') &&
                incoming.thumbnailUrl.length < 220_000
                  ? incoming.thumbnailUrl
                  : undefined,
              deliveryMode: incoming.deliveryMode === 'relay' ? 'relay' : 'webrtc',
              mediaId: incoming.mediaId,
              streamUrl: incoming.streamUrl,
              addedAt: now,
            };
          }

          room.playback = {
            playing: false,
            position: 0,
            rate: 1,
            updatedAtServerMs: now,
          };

          broadcastRoom(room, {
            type: 'video:update',
            video: room.video,
            playback: room.playback,
            serverTime: now,
          });
          break;
        }

        case 'video:remove': {
          if (!isVerifiedAdmin) {
            sendWs(ws, {
              type: 'error',
              code: 'UNAUTHORIZED_ADMIN_ACTION',
              message: 'Viewer Mode — Only the room Admin can remove the video.',
            });
            return;
          }

          for (const oldFile of room.mediaFiles.values()) {
            cleanupSingleMedia(oldFile.filePath);
          }
          room.mediaFiles.clear();

          const now = Date.now();
          room.video = { source: 'none' };
          room.playback = {
            playing: false,
            position: 0,
            rate: 1,
            updatedAtServerMs: now,
          };

          broadcastRoom(room, {
            type: 'video:update',
            video: room.video,
            playback: room.playback,
            serverTime: now,
          });
          break;
        }

        case 'playback:command': {
          if (!isVerifiedAdmin) {
            sendWs(ws, {
              type: 'error',
              code: 'UNAUTHORIZED_ADMIN_ACTION',
              message: 'Viewer Mode — Only the room Admin can control playback.',
            });
            return;
          }

          const allowedActions: PlaybackCommandAction[] = ['play', 'pause', 'seek', 'rate', 'heartbeat'];
          if (!allowedActions.includes(msg.action)) return;

          const now = Date.now();
          const safePosition = Number.isFinite(msg.position) ? Math.max(0, msg.position) : room.playback.position;
          const safeRate =
            typeof msg.rate === 'number' && Number.isFinite(msg.rate)
              ? Math.min(2.5, Math.max(0.25, msg.rate))
              : room.playback.rate;

          room.playback = {
            playing: Boolean(msg.playing),
            position: safePosition,
            rate: safeRate,
            updatedAtServerMs: now,
          };

          broadcastRoom(
            room,
            {
              type: 'playback:sync',
              playback: room.playback,
              serverTime: now,
              reason: msg.action,
            },
            msg.action === 'heartbeat' ? participant.id : undefined
          );
          break;
        }

        case 'room:settings': {
          if (!isVerifiedAdmin) {
            sendWs(ws, {
              type: 'error',
              code: 'UNAUTHORIZED_ADMIN_ACTION',
              message: 'Only the room Admin can update room settings.',
            });
            return;
          }

          const patch = msg.settings ?? {};
          if (typeof patch.title === 'string') {
            room.settings.title = sanitizeRoomTitle(patch.title);
          }
          if (typeof patch.chatEnabled === 'boolean') {
            room.settings.chatEnabled = patch.chatEnabled;
          }
          if (typeof patch.isLocked === 'boolean') {
            room.settings.isLocked = patch.isLocked;
          }
          if (typeof patch.maxParticipants === 'number' && Number.isFinite(patch.maxParticipants)) {
            room.settings.maxParticipants = Math.min(8, Math.max(2, Math.round(patch.maxParticipants)));
          }

          broadcastRoom(room, { type: 'settings:update', settings: { ...room.settings } });
          break;
        }

        case 'room:kick': {
          if (!isVerifiedAdmin) {
            sendWs(ws, {
              type: 'error',
              code: 'UNAUTHORIZED_ADMIN_ACTION',
              message: 'Only the room Admin can remove participants.',
            });
            return;
          }

          const targetId = msg.targetParticipantId;
          if (!targetId || targetId === room.adminId) return;

          const targetSock = room.sockets.get(targetId);
          if (targetSock) {
            sendWs(targetSock, { type: 'room:kicked', reason: 'You were removed from the room by the Admin.' });
            targetSock.close(4008, 'Removed by Admin');
            room.sockets.delete(targetId);
          }
          room.participants.delete(targetId);

          broadcastRoom(room, {
            type: 'participants:update',
            participants: Array.from(room.participants.values()),
            adminOnline: room.adminOnline,
          });
          break;
        }

        case 'room:end': {
          if (!isVerifiedAdmin) {
            sendWs(ws, {
              type: 'error',
              code: 'UNAUTHORIZED_ADMIN_ACTION',
              message: 'Only the room Admin can end the room.',
            });
            return;
          }
          endRoomAndNotify(room, 'The watch party was ended by the room Admin.');
          break;
        }

        // --- WebRTC Signaling (Admin <-> Viewer) ---
        case 'webrtc:request-stream': {
          if (participant.id === room.adminId) return;
          const adminSock = room.sockets.get(room.adminId);
          sendWs(adminSock, { type: 'webrtc:request-stream', fromId: participant.id });
          break;
        }

        case 'webrtc:offer': {
          // Only Admin broadcasts media stream offers to viewers
          if (!isVerifiedAdmin) return;
          const targetSock = room.sockets.get(msg.targetId);
          sendWs(targetSock, { type: 'webrtc:offer', fromId: participant.id, sdp: msg.sdp });
          break;
        }

        case 'webrtc:answer': {
          // Viewer responds to Admin
          const targetSock = room.sockets.get(room.adminId);
          sendWs(targetSock, { type: 'webrtc:answer', fromId: participant.id, sdp: msg.sdp });
          break;
        }

        case 'webrtc:ice': {
          const targetSock = room.sockets.get(msg.targetId);
          sendWs(targetSock, { type: 'webrtc:ice', fromId: participant.id, candidate: msg.candidate });
          break;
        }

        case 'webrtc:fallback-needed': {
          const adminSock = room.sockets.get(room.adminId);
          sendWs(adminSock, {
            type: 'webrtc:fallback-needed',
            fromId: participant.id,
            reason: typeof msg.reason === 'string' ? msg.reason.slice(0, 200) : 'Direct peer connection unavailable.',
          });
          break;
        }
      }
    });

    ws.on('close', () => {
      clearTimeout(authTimeout);
      if (!authedRoom || !authedParticipant) return;
      const room = authedRoom;
      const participant = authedParticipant;

      // Only mark offline if this is still the active socket for the participant
      if (room.sockets.get(participant.id) === ws) {
        room.sockets.delete(participant.id);
        participant.online = false;

        if (participant.id === room.adminId) {
          // Preserve room state; DO NOT transfer Admin role to Viewer
          room.adminOnline = false;
          room.adminDisconnectedAt = Date.now();
        }

        broadcastRoom(room, {
          type: 'participants:update',
          participants: Array.from(room.participants.values()),
          adminOnline: room.adminOnline,
        });
      }
    });
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`SyncWatch server listening on http://0.0.0.0:${PORT}`);
  });
}

void startServer();
