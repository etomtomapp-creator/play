import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import type {
  ChatMessage,
  ClientWsMessage,
  Participant,
  ParticipantRole,
  RoomPreview,
  RoomState,
  VideoState,
} from '../shared/types';
import { auth, db, handleFirestoreError, OperationType } from './firebase';

const ROOM_TTL_MS = 6 * 60 * 60 * 1000;

function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(5);
  crypto.getRandomValues(bytes);
  let suffix = '';
  for (let i = 0; i < 5; i++) {
    suffix += chars[bytes[i] % chars.length];
  }
  return `SW-${suffix}`;
}

function generateDocId(prefix: string): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${prefix}_${hex}`;
}

function toMillis(val: unknown, fallback = Date.now()): number {
  if (val instanceof Timestamp) return val.toMillis();
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  if (val && typeof val === 'object' && 'toMillis' in val && typeof (val as { toMillis: unknown }).toMillis === 'function') {
    return (val as { toMillis: () => number }).toMillis();
  }
  return fallback;
}

function mapDocToRoomState(
  roomId: string,
  data: Record<string, unknown>,
  participants: Participant[],
  messages: ChatMessage[]
): RoomState {
  const videoSource =
    data.videoSource === 'youtube' || data.videoSource === 'gallery' ? data.videoSource : 'none';

  const video: VideoState =
    videoSource === 'youtube'
      ? {
          source: 'youtube',
          youtubeId: typeof data.videoId === 'string' ? data.videoId : undefined,
          title: typeof data.videoTitle === 'string' ? data.videoTitle : 'YouTube Video',
          thumbnailUrl:
            typeof data.videoId === 'string' && data.videoId
              ? `https://i.ytimg.com/vi/${data.videoId}/hqdefault.jpg`
              : undefined,
          addedAt: typeof data.videoAddedAtMs === 'number' ? data.videoAddedAtMs : undefined,
        }
      : videoSource === 'gallery'
      ? {
          source: 'gallery',
          title: typeof data.videoTitle === 'string' ? data.videoTitle : 'Local Movie',
          fileName: typeof data.videoTitle === 'string' ? data.videoTitle : 'Local Movie',
          fileSize: typeof data.videoFileSize === 'number' ? data.videoFileSize : 0,
          duration: typeof data.videoDuration === 'number' ? data.videoDuration : 0,
          deliveryMode: data.videoDeliveryMode === 'relay' ? 'relay' : 'webrtc',
          addedAt: typeof data.videoAddedAtMs === 'number' ? data.videoAddedAtMs : undefined,
        }
      : { source: 'none' };

  return {
    roomId,
    adminId: String(data.adminId || ''),
    adminOnline: data.adminOnline !== false,
    status: data.status === 'ended' ? 'ended' : 'active',
    createdAt: toMillis(data.createdAt),
    expiresAt: toMillis(data.expiresAt, Date.now() + ROOM_TTL_MS),
    settings: {
      title: typeof data.title === 'string' ? data.title : 'Private Watch Room',
      chatEnabled: data.chatEnabled !== false,
      isLocked: data.isLocked === true,
      maxParticipants:
        typeof data.maxParticipants === 'number' ? Math.min(8, Math.max(2, data.maxParticipants)) : 2,
    },
    video,
    playback: {
      playing: data.playbackPlaying === true,
      position: typeof data.playbackPosition === 'number' ? Math.max(0, data.playbackPosition) : 0,
      rate: typeof data.playbackRate === 'number' ? data.playbackRate : 1,
      updatedAtServerMs:
        typeof data.playbackUpdatedAtMs === 'number'
          ? data.playbackUpdatedAtMs
          : toMillis(data.updatedAt),
    },
    participants,
    messages,
  };
}

export async function createFirestoreRoom(params: {
  displayName: string;
  avatar: string;
  title: string;
  maxParticipants: number;
}): Promise<{ room: RoomState; participantId: string; role: 'admin'; token: string }> {
  const user = auth.currentUser;
  if (!user || !user.emailVerified) {
    throw new Error('Please sign in with Google to create a live SyncWatch room.');
  }

  const roomCode = generateRoomCode();
  const now = Date.now();
  const expiresAtMs = now + ROOM_TTL_MS;
  const safeName = params.displayName.trim().slice(0, 40) || 'Host';
  const safeAvatar = params.avatar.trim().slice(0, 256) || 'cosmic';
  const safeTitle = params.title.trim().slice(0, 80) || 'Private Watch Room';
  const safeCap = Math.min(8, Math.max(2, Math.round(params.maxParticipants || 2)));

  const roomPath = `rooms/${roomCode}`;
  try {
    await setDoc(doc(db, 'rooms', roomCode), {
      roomCode,
      adminId: user.uid,
      adminName: safeName,
      adminAvatar: safeAvatar,
      adminOnline: true,
      title: safeTitle,
      status: 'active',
      maxParticipants: safeCap,
      chatEnabled: true,
      isLocked: false,
      videoSource: 'none',
      videoId: '',
      videoTitle: '',
      videoFileSize: 0,
      videoDuration: 0,
      videoDeliveryMode: 'webrtc',
      videoAddedAtMs: 0,
      playbackPlaying: false,
      playbackPosition: 0,
      playbackRate: 1,
      playbackUpdatedAtMs: now,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      expiresAt: Timestamp.fromMillis(expiresAtMs),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, roomPath);
  }

  const participantPath = `rooms/${roomCode}/participants/${user.uid}`;
  try {
    await setDoc(doc(db, 'rooms', roomCode, 'participants', user.uid), {
      userId: user.uid,
      roomId: roomCode,
      roomAdminId: user.uid,
      displayName: safeName,
      avatar: safeAvatar,
      role: 'admin',
      isOnline: true,
      joinedAt: serverTimestamp(),
      lastSeenAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, participantPath);
  }

  const adminParticipant: Participant = {
    id: user.uid,
    displayName: safeName,
    avatar: safeAvatar,
    role: 'admin',
    online: true,
    joinedAt: now,
    firebaseUid: user.uid,
  };

  const room: RoomState = {
    roomId: roomCode,
    adminId: user.uid,
    adminOnline: true,
    status: 'active',
    createdAt: now,
    expiresAt: expiresAtMs,
    settings: {
      title: safeTitle,
      chatEnabled: true,
      isLocked: false,
      maxParticipants: safeCap,
    },
    video: { source: 'none' },
    playback: { playing: false, position: 0, rate: 1, updatedAtServerMs: now },
    participants: [adminParticipant],
    messages: [],
  };

  return {
    room,
    participantId: user.uid,
    role: 'admin',
    token: 'firestore-auth',
  };
}

export async function previewFirestoreRoom(roomCodeInput: string): Promise<RoomPreview> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('Sign in with Google above to check and join this live room.');
  }

  const roomCode = roomCodeInput.trim().toUpperCase();
  if (!/^SW-[A-Z0-9]{5}$/.test(roomCode)) {
    throw new Error('Room ID format is invalid. Expected format like SW-7F3D9.');
  }

  const roomPath = `rooms/${roomCode}`;
  let snap;
  try {
    snap = await getDoc(doc(db, 'rooms', roomCode));
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, roomPath);
  }

  if (!snap.exists()) {
    throw new Error('Room not found. Double-check the Room ID or ask your friend for a fresh invite link.');
  }

  const data = snap.data();
  if (data.status === 'ended') {
    throw new Error('This watch party has already been ended by the Admin.');
  }
  if (toMillis(data.expiresAt, Date.now() + 1000) < Date.now()) {
    throw new Error('This room has expired. Ask your friend to generate a new team.');
  }

  let participantCount = 1;
  try {
    const pSnap = await getDocs(
      query(collection(db, 'rooms', roomCode, 'participants'), where('roomId', '==', roomCode))
    );
    participantCount = Math.max(1, pSnap.size);
  } catch {
    participantCount = 1;
  }

  return {
    roomId: roomCode,
    title: typeof data.title === 'string' ? data.title : 'Private Watch Room',
    adminName: typeof data.adminName === 'string' ? data.adminName : 'Room Admin',
    adminAvatar: typeof data.adminAvatar === 'string' ? data.adminAvatar : 'cosmic',
    participantCount,
    maxParticipants: typeof data.maxParticipants === 'number' ? data.maxParticipants : 2,
    isLocked: data.isLocked === true,
    status: data.status === 'ended' ? 'ended' : 'active',
    videoSource:
      data.videoSource === 'youtube' || data.videoSource === 'gallery' ? data.videoSource : 'none',
    videoTitle: typeof data.videoTitle === 'string' && data.videoTitle ? data.videoTitle : undefined,
    createdAt: toMillis(data.createdAt),
  };
}

export async function joinFirestoreRoom(params: {
  roomCode: string;
  displayName: string;
  avatar: string;
}): Promise<{ room: RoomState; participantId: string; role: ParticipantRole; token: string }> {
  const user = auth.currentUser;
  if (!user || !user.emailVerified) {
    throw new Error('Please sign in with Google to join this live SyncWatch room.');
  }

  const roomCode = params.roomCode.trim().toUpperCase();
  const roomPath = `rooms/${roomCode}`;
  let snap;
  try {
    snap = await getDoc(doc(db, 'rooms', roomCode));
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, roomPath);
  }

  if (!snap.exists()) {
    throw new Error('No active room matches that Room ID.');
  }

  const data = snap.data();
  if (data.status === 'ended') {
    throw new Error('This room was ended by the Admin.');
  }
  if (toMillis(data.expiresAt, Date.now() + 1000) < Date.now()) {
    throw new Error('This room has expired.');
  }

  const isCreatorAdmin = data.adminId === user.uid;
  const role: ParticipantRole = isCreatorAdmin ? 'admin' : 'viewer';

  if (!isCreatorAdmin && data.isLocked === true) {
    throw new Error('This private room is currently locked by the Admin.');
  }

  const pQuery = query(
    collection(db, 'rooms', roomCode, 'participants'),
    where('roomId', '==', roomCode)
  );
  const existingPartSnap = await getDocs(pQuery);
  const alreadyMember = existingPartSnap.docs.some((d) => d.id === user.uid);
  const maxP = typeof data.maxParticipants === 'number' ? data.maxParticipants : 2;
  if (!alreadyMember && existingPartSnap.size >= maxP) {
    throw new Error(`This room is full (${existingPartSnap.size}/${maxP} participants).`);
  }

  const safeName = params.displayName.trim().slice(0, 40) || 'Friend';
  const safeAvatar = params.avatar.trim().slice(0, 256) || 'cosmic';
  const pRef = doc(db, 'rooms', roomCode, 'participants', user.uid);
  const pPath = `rooms/${roomCode}/participants/${user.uid}`;

  try {
    if (alreadyMember) {
      await updateDoc(pRef, {
        displayName: safeName,
        avatar: safeAvatar,
        isOnline: true,
        lastSeenAt: serverTimestamp(),
      });
    } else {
      await setDoc(pRef, {
        userId: user.uid,
        roomId: roomCode,
        roomAdminId: String(data.adminId),
        displayName: safeName,
        avatar: safeAvatar,
        role,
        isOnline: true,
        joinedAt: serverTimestamp(),
        lastSeenAt: serverTimestamp(),
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, pPath);
  }

  const participants: Participant[] = existingPartSnap.docs.map((d) => {
    const pd = d.data();
    return {
      id: d.id,
      displayName: String(pd.displayName || 'Participant'),
      avatar: String(pd.avatar || 'cosmic'),
      role: pd.role === 'admin' ? 'admin' : 'viewer',
      online: pd.isOnline !== false,
      joinedAt: toMillis(pd.joinedAt),
      firebaseUid: d.id,
    };
  });

  if (!alreadyMember) {
    participants.push({
      id: user.uid,
      displayName: safeName,
      avatar: safeAvatar,
      role,
      online: true,
      joinedAt: Date.now(),
      firebaseUid: user.uid,
    });
  }

  return {
    room: mapDocToRoomState(roomCode, data, participants, []),
    participantId: user.uid,
    role,
    token: 'firestore-auth',
  };
}

export interface FirestoreSignalEvent {
  fromId: string;
  signalType: 'request-stream' | 'offer' | 'answer' | 'ice' | 'fallback-needed';
  payload: unknown;
}

export function subscribeFirestoreRoom(params: {
  roomId: string;
  selfId: string;
  isAdmin: boolean;
  onRoomUpdate: (room: RoomState) => void;
  onEnded: (reason: string) => void;
  onKicked: (reason: string) => void;
  onSignal: (signal: FirestoreSignalEvent) => void;
  onConnected: () => void;
}): () => void {
  const { roomId, selfId, isAdmin, onRoomUpdate, onEnded, onKicked, onSignal, onConnected } = params;

  let latestRoomData: Record<string, unknown> | null = null;
  let latestParticipants: Participant[] = [];
  let latestMessages: ChatMessage[] = [];
  let hasJoinedSelf = false;
  let unsubscribed = false;

  const emitCombined = () => {
    if (!latestRoomData || unsubscribed) return;
    onRoomUpdate(mapDocToRoomState(roomId, latestRoomData, latestParticipants, latestMessages));
  };

  // Mark online
  if (isAdmin) {
    void updateDoc(doc(db, 'rooms', roomId), {
      adminOnline: true,
      updatedAt: serverTimestamp(),
    }).catch(() => undefined);
  }

  const unsubRoom = onSnapshot(
    doc(db, 'rooms', roomId),
    (snap) => {
      if (!snap.exists()) {
        onEnded('This room no longer exists.');
        return;
      }
      const data = snap.data();
      if (data.status === 'ended') {
        onEnded('The watch party was ended by the room Admin.');
        return;
      }
      latestRoomData = data;
      onConnected();
      emitCombined();
    },
    (error) => {
      handleFirestoreError(error, OperationType.GET, `rooms/${roomId}`);
    }
  );

  const unsubParticipants = onSnapshot(
    query(collection(db, 'rooms', roomId, 'participants'), where('roomId', '==', roomId)),
    (snap) => {
      latestParticipants = snap.docs.map((d) => {
        const pd = d.data();
        return {
          id: d.id,
          displayName: String(pd.displayName || 'Participant'),
          avatar: String(pd.avatar || 'cosmic'),
          role: pd.role === 'admin' ? 'admin' : 'viewer',
          online: pd.isOnline !== false,
          joinedAt: toMillis(pd.joinedAt),
          firebaseUid: d.id,
        };
      });

      const selfPresent = latestParticipants.some((p) => p.id === selfId);
      if (selfPresent) {
        hasJoinedSelf = true;
      } else if (hasJoinedSelf && !isAdmin) {
        onKicked('You were removed from the room by the Admin.');
        return;
      }

      emitCombined();
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, `rooms/${roomId}/participants`);
    }
  );

  const unsubMessages = onSnapshot(
    query(
      collection(db, 'rooms', roomId, 'messages'),
      where('roomId', '==', roomId),
      orderBy('createdAt', 'asc')
    ),
    (snap) => {
      latestMessages = snap.docs.map((d) => {
        const md = d.data();
        return {
          id: d.id,
          senderId: String(md.senderId || ''),
          senderName: String(md.senderName || 'User'),
          senderAvatar: String(md.senderAvatar || 'cosmic'),
          senderRole: md.senderRole === 'admin' ? 'admin' : 'viewer',
          text: String(md.text || ''),
          timestamp: toMillis(md.createdAt),
          reactions: (md.reactions && typeof md.reactions === 'object' ? md.reactions : {}) as Record<
            string,
            string[]
          >,
        };
      });
      emitCombined();
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, `rooms/${roomId}/messages`);
    }
  );

  // Ephemeral WebRTC signaling listener scoped strictly to toId == selfId
  const processedSignalIds = new Set<string>();
  const unsubSignals = onSnapshot(
    query(collection(db, 'rooms', roomId, 'signals'), where('toId', '==', selfId)),
    (snap) => {
      snap.docChanges().forEach((change) => {
        if (change.type !== 'added') return;
        const docId = change.doc.id;
        if (processedSignalIds.has(docId)) return;
        processedSignalIds.add(docId);

        const sd = change.doc.data();
        let parsedPayload: unknown = null;
        try {
          parsedPayload = sd.payload ? JSON.parse(String(sd.payload)) : null;
        } catch {
          parsedPayload = sd.payload;
        }

        onSignal({
          fromId: String(sd.fromId || ''),
          signalType: sd.signalType as FirestoreSignalEvent['signalType'],
          payload: parsedPayload,
        });

        // Clean up consumed signaling doc
        void deleteDoc(change.doc.ref).catch(() => undefined);
      });
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, `rooms/${roomId}/signals`);
    }
  );

  return () => {
    unsubscribed = true;
    unsubRoom();
    unsubParticipants();
    unsubMessages();
    unsubSignals();
    // Mark offline on cleanup
    void updateDoc(doc(db, 'rooms', roomId, 'participants', selfId), {
      isOnline: false,
      lastSeenAt: serverTimestamp(),
    }).catch(() => undefined);
    if (isAdmin) {
      void updateDoc(doc(db, 'rooms', roomId), {
        adminOnline: false,
        updatedAt: serverTimestamp(),
      }).catch(() => undefined);
    }
  };
}

export async function dispatchFirestoreRoomMessage(params: {
  room: RoomState;
  selfId: string;
  role: ParticipantRole;
  displayName: string;
  avatar: string;
  msg: ClientWsMessage;
}): Promise<void> {
  const { room, selfId, role, displayName, avatar, msg } = params;
  const isAdmin = role === 'admin' && room.adminId === selfId;
  const roomRef = doc(db, 'rooms', room.roomId);

  switch (msg.type) {
    case 'profile:update': {
      await updateDoc(doc(db, 'rooms', room.roomId, 'participants', selfId), {
        displayName: msg.displayName.trim().slice(0, 40) || displayName,
        avatar: msg.avatar.trim().slice(0, 256) || avatar,
        isOnline: true,
        lastSeenAt: serverTimestamp(),
      });
      if (isAdmin) {
        await updateDoc(roomRef, {
          adminName: msg.displayName.trim().slice(0, 40) || displayName,
          adminAvatar: msg.avatar.trim().slice(0, 256) || avatar,
          adminOnline: true,
          updatedAt: serverTimestamp(),
        });
      }
      return;
    }

    case 'chat:send': {
      const cleanText = msg.text.trim().slice(0, 600);
      if (!cleanText) return;
      const msgId = generateDocId('msg');
      await setDoc(doc(db, 'rooms', room.roomId, 'messages', msgId), {
        roomId: room.roomId,
        senderId: selfId,
        roomAdminId: room.adminId,
        senderName: displayName.trim().slice(0, 40) || 'User',
        senderAvatar: avatar.trim().slice(0, 256) || 'cosmic',
        senderRole: role,
        text: cleanText,
        reactions: {},
        createdAt: serverTimestamp(),
      });
      return;
    }

    case 'chat:react': {
      const target = room.messages.find((m) => m.id === msg.messageId);
      if (!target) return;
      const nextReactions: Record<string, string[]> = { ...(target.reactions || {}) };
      const existing = nextReactions[msg.emoji] ?? [];
      if (existing.includes(selfId)) {
        const filtered = existing.filter((id) => id !== selfId);
        if (filtered.length === 0) delete nextReactions[msg.emoji];
        else nextReactions[msg.emoji] = filtered;
      } else {
        nextReactions[msg.emoji] = [...existing, selfId];
      }
      await updateDoc(doc(db, 'rooms', room.roomId, 'messages', msg.messageId), {
        reactions: nextReactions,
      });
      return;
    }

    case 'video:set': {
      if (!isAdmin) return;
      const now = Date.now();
      await updateDoc(roomRef, {
        videoSource: msg.video.source,
        videoId: (msg.video.youtubeId || msg.video.mediaId || 'webrtc').slice(0, 128),
        videoTitle: (msg.video.title || msg.video.fileName || 'Shared Video').slice(0, 160),
        videoFileSize: Number(msg.video.fileSize || 0),
        videoDuration: Number(msg.video.duration || 0),
        videoDeliveryMode: msg.video.deliveryMode === 'relay' ? 'relay' : 'webrtc',
        videoAddedAtMs: now,
        playbackPlaying: false,
        playbackPosition: 0,
        playbackRate: 1,
        playbackUpdatedAtMs: now,
        updatedAt: serverTimestamp(),
      });
      return;
    }

    case 'video:remove': {
      if (!isAdmin) return;
      const now = Date.now();
      await updateDoc(roomRef, {
        videoSource: 'none',
        videoId: '',
        videoTitle: '',
        videoFileSize: 0,
        videoDuration: 0,
        videoDeliveryMode: 'webrtc',
        videoAddedAtMs: 0,
        playbackPlaying: false,
        playbackPosition: 0,
        playbackRate: 1,
        playbackUpdatedAtMs: now,
        updatedAt: serverTimestamp(),
      });
      return;
    }

    case 'playback:command': {
      if (!isAdmin) return;
      await updateDoc(roomRef, {
        playbackPlaying: Boolean(msg.playing),
        playbackPosition: Math.max(0, Number(msg.position) || 0),
        playbackRate: Math.min(2.5, Math.max(0.25, Number(msg.rate ?? room.playback.rate) || 1)),
        playbackUpdatedAtMs: Date.now(),
        updatedAt: serverTimestamp(),
      });
      return;
    }

    case 'room:settings': {
      if (!isAdmin) return;
      await updateDoc(roomRef, {
        title: (msg.settings.title ?? room.settings.title).trim().slice(0, 80) || 'Private Watch Room',
        chatEnabled: msg.settings.chatEnabled ?? room.settings.chatEnabled,
        isLocked: msg.settings.isLocked ?? room.settings.isLocked,
        maxParticipants: Math.min(
          8,
          Math.max(2, Math.round(msg.settings.maxParticipants ?? room.settings.maxParticipants))
        ),
        updatedAt: serverTimestamp(),
      });
      return;
    }

    case 'room:kick': {
      if (!isAdmin || !msg.targetParticipantId || msg.targetParticipantId === selfId) return;
      await deleteDoc(doc(db, 'rooms', room.roomId, 'participants', msg.targetParticipantId));
      return;
    }

    case 'room:end': {
      if (!isAdmin) return;
      await updateDoc(roomRef, {
        status: 'ended',
        updatedAt: serverTimestamp(),
      });
      return;
    }

    case 'webrtc:request-stream': {
      const sigId = generateDocId('sig');
      await setDoc(doc(db, 'rooms', room.roomId, 'signals', sigId), {
        fromId: selfId,
        toId: room.adminId,
        signalType: 'request-stream',
        payload: '{}',
        createdAt: serverTimestamp(),
      });
      return;
    }

    case 'webrtc:offer': {
      const sigId = generateDocId('sig');
      await setDoc(doc(db, 'rooms', room.roomId, 'signals', sigId), {
        fromId: selfId,
        toId: msg.targetId,
        signalType: 'offer',
        payload: JSON.stringify(msg.sdp),
        createdAt: serverTimestamp(),
      });
      return;
    }

    case 'webrtc:answer': {
      const sigId = generateDocId('sig');
      await setDoc(doc(db, 'rooms', room.roomId, 'signals', sigId), {
        fromId: selfId,
        toId: room.adminId,
        signalType: 'answer',
        payload: JSON.stringify(msg.sdp),
        createdAt: serverTimestamp(),
      });
      return;
    }

    case 'webrtc:ice': {
      const sigId = generateDocId('sig');
      await setDoc(doc(db, 'rooms', room.roomId, 'signals', sigId), {
        fromId: selfId,
        toId: msg.targetId,
        signalType: 'ice',
        payload: JSON.stringify(msg.candidate),
        createdAt: serverTimestamp(),
      });
      return;
    }

    case 'webrtc:fallback-needed': {
      const sigId = generateDocId('sig');
      await setDoc(doc(db, 'rooms', room.roomId, 'signals', sigId), {
        fromId: selfId,
        toId: room.adminId,
        signalType: 'fallback-needed',
        payload: JSON.stringify({ reason: msg.reason }),
        createdAt: serverTimestamp(),
      });
      return;
    }
  }
}
