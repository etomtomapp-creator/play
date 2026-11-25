import { useEffect, useState } from 'react';
import { ErrorBoundary } from './components/ErrorBoundary';
import { GenerateJoinModal, type TransportMode } from './components/GenerateJoinModal';
import { LandingPage } from './components/LandingPage';
import { ProfileModal } from './components/ProfileModal';
import { WatchRoom } from './components/WatchRoom';
import {
  loadUserProfileFromFirestore,
  persistRoomCreatedToFirestore,
  saveUserProfileToFirestore,
  subscribeAuth,
} from './lib/firebase';
import type { ParticipantRole, RoomState, UserProfileData } from './shared/types';

const PROFILE_STORAGE_KEY = 'syncwatch_profile_v1';

interface ActiveSession {
  room: RoomState;
  participantId: string;
  role: ParticipantRole;
  token: string;
  isNewlyCreated: boolean;
  transportMode: TransportMode;
}

function loadLocalProfile(): UserProfileData {
  try {
    const raw = localStorage.getItem(PROFILE_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { displayName?: string; avatar?: string };
      if (parsed.displayName) {
        return {
          displayName: parsed.displayName.slice(0, 40),
          avatar: parsed.avatar || 'cosmic',
          firebaseUid: null,
          email: null,
          isAuthenticated: false,
        };
      }
    }
  } catch {
    // Ignore storage errors
  }
  return {
    displayName: 'Guest',
    avatar: 'cosmic',
    firebaseUid: null,
    email: null,
    isAuthenticated: false,
  };
}

function extractJoinRoomIdFromUrl(): string | null {
  const match = /^\/join\/(SW-[A-Z0-9]{5})\/?$/i.exec(window.location.pathname);
  return match ? match[1].toUpperCase() : null;
}

function SyncWatchApp() {
  const [profile, setProfile] = useState<UserProfileData>(() => loadLocalProfile());
  const [session, setSession] = useState<ActiveSession | null>(null);
  const [modalMode, setModalMode] = useState<'generate' | 'join' | null>(() => {
    return extractJoinRoomIdFromUrl() ? 'join' : null;
  });
  const [pendingJoinId, setPendingJoinId] = useState<string>(() => {
    return extractJoinRoomIdFromUrl() ?? '';
  });
  const [showProfileModal, setShowProfileModal] = useState(false);

  // Subscribe to optional Firebase Google Auth and load Firestore profile
  useEffect(() => {
    const unsubscribe = subscribeAuth((user) => {
      if (!user) {
        setProfile((prev) => ({
          ...prev,
          firebaseUid: null,
          email: null,
          isAuthenticated: false,
        }));
        return;
      }

      setProfile((prev) => ({
        ...prev,
        displayName:
          prev.displayName === 'Guest' && user.displayName
            ? user.displayName.slice(0, 40)
            : prev.displayName,
        firebaseUid: user.uid,
        email: user.email,
        isAuthenticated: true,
      }));

      void loadUserProfileFromFirestore(user.uid)
        .then((stored) => {
          if (stored) {
            setProfile((prev) => ({
              ...prev,
              displayName: stored.displayName,
              avatar: stored.avatar,
            }));
            try {
              localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(stored));
            } catch {
              // Ignore
            }
          }
        })
        .catch(() => {
          // Non-blocking profile sync error
        });
    });

    return () => unsubscribe();
  }, []);

  // Support browser back/forward navigation for /join/SW-XXXXX links
  useEffect(() => {
    const onPopState = () => {
      const joinCode = extractJoinRoomIdFromUrl();
      if (joinCode && !session) {
        setPendingJoinId(joinCode);
        setModalMode('join');
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [session]);

  function handleUpdateProfile(displayName: string, avatar: string) {
    const cleanName = displayName.trim().slice(0, 40) || 'Guest';
    setProfile((prev) => ({
      ...prev,
      displayName: cleanName,
      avatar,
    }));
    try {
      localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify({ displayName: cleanName, avatar }));
    } catch {
      // Ignore
    }
    if (profile.firebaseUid) {
      void saveUserProfileToFirestore(profile.firebaseUid, cleanName, avatar).catch(() => undefined);
    }
  }

  function handleRoomEntered(payload: ActiveSession) {
    setSession(payload);
    setModalMode(null);
    setPendingJoinId('');
    try {
      window.history.replaceState({}, '', `/room/${payload.room.roomId}`);
    } catch {
      // Ignore
    }

    if (
      payload.transportMode === 'server' &&
      payload.isNewlyCreated &&
      payload.role === 'admin' &&
      profile.isAuthenticated
    ) {
      void persistRoomCreatedToFirestore({
        roomCode: payload.room.roomId,
        title: payload.room.settings.title,
        maxParticipants: payload.room.settings.maxParticipants,
        chatEnabled: payload.room.settings.chatEnabled,
        isLocked: payload.room.settings.isLocked,
        expiresAtMs: payload.room.expiresAt,
        displayName: profile.displayName,
        avatar: profile.avatar,
      }).catch(() => undefined);
    }
  }

  function handleLeaveRoom() {
    setSession(null);
    try {
      window.history.replaceState({}, '', '/');
    } catch {
      // Ignore
    }
  }

  return (
    <>
      {session ? (
        <WatchRoom
          initialRoom={session.room}
          selfId={session.participantId}
          role={session.role}
          token={session.token}
          isNewlyCreated={session.isNewlyCreated}
          transportMode={session.transportMode}
          profile={profile}
          onOpenProfile={() => setShowProfileModal(true)}
          onLeaveRoom={handleLeaveRoom}
        />
      ) : (
        <LandingPage
          profile={profile}
          onGenerateTeam={() => {
            setPendingJoinId('');
            setModalMode('generate');
          }}
          onJoinTeam={() => {
            setModalMode('join');
          }}
          onOpenProfile={() => setShowProfileModal(true)}
        />
      )}

      {modalMode && !session && (
        <GenerateJoinModal
          mode={modalMode}
          initialRoomId={pendingJoinId}
          profile={profile}
          onUpdateProfile={handleUpdateProfile}
          onClose={() => {
            setModalMode(null);
            if (window.location.pathname.startsWith('/join/')) {
              try {
                window.history.replaceState({}, '', '/');
              } catch {
                // Ignore
              }
            }
          }}
          onSuccess={handleRoomEntered}
        />
      )}

      {showProfileModal && (
        <ProfileModal
          profile={profile}
          onSave={handleUpdateProfile}
          onClose={() => setShowProfileModal(false)}
        />
      )}
    </>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <SyncWatchApp />
    </ErrorBoundary>
  );
}
