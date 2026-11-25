import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  type User,
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDoc,
  getDocFromServer,
  setDoc,
  updateDoc,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

let connectionTested = false;

export async function testConnection(): Promise<void> {
  if (connectionTested) return;
  connectionTested = true;
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

// Run startup connectivity check
void testConnection();

export async function signInWithGoogle(): Promise<User> {
  const result = await signInWithPopup(auth, googleProvider);
  return result.user;
}

export async function signOutGoogle(): Promise<void> {
  await firebaseSignOut(auth);
}

export function subscribeAuth(callback: (user: User | null) => void): () => void {
  return onAuthStateChanged(auth, callback);
}

function sanitizeDisplayName(name: string): string {
  const cleaned = name.trim().slice(0, 40);
  return cleaned.length > 0 ? cleaned : 'Viewer';
}

function sanitizeAvatar(avatar: string): string {
  const cleaned = avatar.trim().slice(0, 256);
  return cleaned.length > 0 ? cleaned : 'cosmic';
}

export async function loadUserProfileFromFirestore(
  uid: string
): Promise<{ displayName: string; avatar: string } | null> {
  const path = `users/${uid}`;
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    if (!snap.exists()) return null;
    const data = snap.data();
    return {
      displayName: typeof data.displayName === 'string' ? data.displayName : 'SyncWatch User',
      avatar: typeof data.avatar === 'string' ? data.avatar : 'cosmic',
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function saveUserProfileToFirestore(
  uid: string,
  displayName: string,
  avatar: string
): Promise<void> {
  const path = `users/${uid}`;
  const safeName = sanitizeDisplayName(displayName);
  const safeAvatar = sanitizeAvatar(avatar);
  try {
    const ref = doc(db, 'users', uid);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        userId: uid,
        displayName: safeName,
        avatar: safeAvatar,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ref, {
        displayName: safeName,
        avatar: safeAvatar,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function persistRoomCreatedToFirestore(params: {
  roomCode: string;
  title: string;
  maxParticipants: number;
  chatEnabled: boolean;
  isLocked: boolean;
  expiresAtMs: number;
  displayName: string;
  avatar: string;
}): Promise<void> {
  const user = auth.currentUser;
  if (!user || !user.emailVerified) return;

  const roomPath = `rooms/${params.roomCode}`;
  try {
    await setDoc(doc(db, 'rooms', params.roomCode), {
      roomCode: params.roomCode,
      adminId: user.uid,
      adminName: sanitizeDisplayName(params.displayName),
      adminAvatar: sanitizeAvatar(params.avatar),
      adminOnline: true,
      title: params.title.trim().slice(0, 80) || 'Private Watch Room',
      status: 'active',
      maxParticipants: Math.min(8, Math.max(2, Math.round(params.maxParticipants))),
      chatEnabled: Boolean(params.chatEnabled),
      isLocked: Boolean(params.isLocked),
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
      playbackUpdatedAtMs: Date.now(),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      expiresAt: Timestamp.fromMillis(params.expiresAtMs),
    });

    const participantPath = `rooms/${params.roomCode}/participants/${user.uid}`;
    try {
      await setDoc(doc(db, 'rooms', params.roomCode, 'participants', user.uid), {
        userId: user.uid,
        roomId: params.roomCode,
        roomAdminId: user.uid,
        displayName: sanitizeDisplayName(params.displayName),
        avatar: sanitizeAvatar(params.avatar),
        role: 'admin',
        isOnline: true,
        joinedAt: serverTimestamp(),
        lastSeenAt: serverTimestamp(),
      });
    } catch (participantErr) {
      handleFirestoreError(participantErr, OperationType.CREATE, participantPath);
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, roomPath);
  }
}

export async function persistRoomVideoUpdateToFirestore(params: {
  roomCode: string;
  videoSource: 'none' | 'youtube' | 'gallery';
  videoId: string;
  videoTitle: string;
  playbackPlaying: boolean;
  playbackPosition: number;
  playbackRate: number;
}): Promise<void> {
  const user = auth.currentUser;
  if (!user || !user.emailVerified) return;

  const roomPath = `rooms/${params.roomCode}`;
  try {
    const snap = await getDoc(doc(db, 'rooms', params.roomCode));
    if (!snap.exists() || snap.data().adminId !== user.uid || snap.data().status === 'ended') {
      return;
    }
    await updateDoc(doc(db, 'rooms', params.roomCode), {
      videoSource: params.videoSource,
      videoId: params.videoId.slice(0, 128),
      videoTitle: params.videoTitle.slice(0, 160),
      playbackPlaying: Boolean(params.playbackPlaying),
      playbackPosition: Math.max(0, Number(params.playbackPosition) || 0),
      playbackRate: Math.min(2.5, Math.max(0.25, Number(params.playbackRate) || 1)),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, roomPath);
  }
}

export async function persistRoomEndedToFirestore(roomCode: string): Promise<void> {
  const user = auth.currentUser;
  if (!user || !user.emailVerified) return;

  const roomPath = `rooms/${roomCode}`;
  try {
    const snap = await getDoc(doc(db, 'rooms', roomCode));
    if (!snap.exists() || snap.data().adminId !== user.uid || snap.data().status === 'ended') {
      return;
    }
    await updateDoc(doc(db, 'rooms', roomCode), {
      status: 'ended',
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, roomPath);
  }
}
