import { useEffect, useState } from 'react';
import {
  AlertCircle,
  Check,
  Film,
  Loader2,
  Lock,
  LogIn,
  Plus,
  Users,
  X,
  Youtube,
} from 'lucide-react';
import { AVATAR_OPTIONS } from '../lib/avatars';
import { signInWithGoogle } from '../lib/firebase';
import {
  createFirestoreRoom,
  joinFirestoreRoom,
  previewFirestoreRoom,
} from '../lib/firestoreRooms';
import { checkBackendApiAvailable, safeFetchJson } from '../lib/safeFetch';
import type { RoomPreview, RoomState, UserProfileData } from '../shared/types';
import { Avatar } from './Avatar';

export type TransportMode = 'server' | 'firestore';

interface GenerateJoinModalProps {
  mode: 'generate' | 'join';
  initialRoomId?: string;
  profile: UserProfileData;
  onUpdateProfile: (displayName: string, avatar: string) => void;
  onClose: () => void;
  onSuccess: (payload: {
    room: RoomState;
    participantId: string;
    role: 'admin' | 'viewer';
    token: string;
    isNewlyCreated: boolean;
    transportMode: TransportMode;
  }) => void;
}

export function GenerateJoinModal({
  mode,
  initialRoomId = '',
  profile,
  onUpdateProfile,
  onClose,
  onSuccess,
}: GenerateJoinModalProps) {
  const [activeMode, setActiveMode] = useState<'generate' | 'join'>(mode);
  const [displayName, setDisplayName] = useState(profile.displayName || '');
  const [selectedAvatar, setSelectedAvatar] = useState(profile.avatar || 'cosmic');
  const [roomTitle, setRoomTitle] = useState('Movie Night');
  const [maxParticipants, setMaxParticipants] = useState(2);

  // Automatic backend detection (Express API vs Static Netlify + Firestore)
  const [backendAvailable, setBackendAvailable] = useState<boolean | null>(null);
  const [authBusy, setAuthBusy] = useState(false);

  // Join mode state
  const [roomIdInput, setRoomIdInput] = useState(initialRoomId.toUpperCase());
  const [preview, setPreview] = useState<RoomPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void checkBackendApiAvailable().then((available) => {
      if (!cancelled) setBackendAvailable(available);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Fetch room preview automatically whenever a valid SW-XXXXX code is entered
  useEffect(() => {
    if (activeMode !== 'join' || backendAvailable === null) return;
    const normalized = roomIdInput.trim().toUpperCase();
    if (!/^SW-[A-Z0-9]{5}$/.test(normalized)) {
      setPreview(null);
      setPreviewError(null);
      return;
    }

    let cancelled = false;
    setPreviewLoading(true);
    setPreviewError(null);

    if (backendAvailable) {
      safeFetchJson<{ preview?: RoomPreview; message?: string }>(
        `/api/rooms/${encodeURIComponent(normalized)}/preview`
      )
        .then((res) => {
          if (cancelled) return;
          if (!res.isJson) {
            setBackendAvailable(false);
            return;
          }
          if (!res.ok) {
            setPreview(null);
            setPreviewError(res.data?.message || 'Unable to find that room.');
          } else {
            setPreview(res.data?.preview ?? null);
            setPreviewError(null);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setPreview(null);
            setPreviewError('Network error while checking this room.');
          }
        })
        .finally(() => {
          if (!cancelled) setPreviewLoading(false);
        });
    } else {
      previewFirestoreRoom(normalized)
        .then((p) => {
          if (!cancelled) {
            setPreview(p);
            setPreviewError(null);
          }
        })
        .catch((err) => {
          if (!cancelled) {
            setPreview(null);
            setPreviewError(err instanceof Error ? err.message : 'Unable to find that room.');
          }
        })
        .finally(() => {
          if (!cancelled) setPreviewLoading(false);
        });
    }

    return () => {
      cancelled = true;
    };
  }, [activeMode, roomIdInput, backendAvailable, profile.isAuthenticated]);

  async function handleGoogleSignInInline() {
    setAuthBusy(true);
    setError(null);
    try {
      const user = await signInWithGoogle();
      if (user.displayName && (!displayName.trim() || displayName === 'Guest')) {
        setDisplayName(user.displayName.slice(0, 40));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google sign-in was cancelled or failed.');
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const cleanName = displayName.trim();
    if (!cleanName) {
      setError('Please enter your display name.');
      return;
    }

    onUpdateProfile(cleanName, selectedAvatar);
    setSubmitting(true);

    try {
      const useServer = backendAvailable ?? (await checkBackendApiAvailable());

      if (useServer) {
        if (activeMode === 'generate') {
          const res = await safeFetchJson<{
            room?: RoomState;
            participantId?: string;
            role?: 'admin';
            token?: string;
            message?: string;
          }>('/api/rooms', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              displayName: cleanName,
              avatar: selectedAvatar,
              title: roomTitle.trim() || 'Private Watch Room',
              maxParticipants,
              firebaseUid: profile.firebaseUid ?? null,
            }),
          });

          // If host returned HTML/empty body (static host like Netlify), fall back cleanly to Firestore
          if (!res.isJson) {
            setBackendAvailable(false);
            const fsCreated = await createFirestoreRoom({
              displayName: cleanName,
              avatar: selectedAvatar,
              title: roomTitle.trim() || 'Private Watch Room',
              maxParticipants,
            });
            onSuccess({
              ...fsCreated,
              isNewlyCreated: true,
              transportMode: 'firestore',
            });
            return;
          }

          if (!res.ok || !res.data?.room || !res.data?.participantId || !res.data?.token) {
            throw new Error(res.data?.message || 'Failed to create room.');
          }

          onSuccess({
            room: res.data.room,
            participantId: res.data.participantId,
            role: 'admin',
            token: res.data.token,
            isNewlyCreated: true,
            transportMode: 'server',
          });
        } else {
          const normalized = roomIdInput.trim().toUpperCase();
          if (!/^SW-[A-Z0-9]{5}$/.test(normalized)) {
            throw new Error('Enter a valid Room ID in the format SW-XXXXX.');
          }
          const res = await safeFetchJson<{
            room?: RoomState;
            participantId?: string;
            role?: 'viewer';
            token?: string;
            message?: string;
          }>(`/api/rooms/${encodeURIComponent(normalized)}/join`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              displayName: cleanName,
              avatar: selectedAvatar,
              firebaseUid: profile.firebaseUid ?? null,
            }),
          });

          if (!res.isJson) {
            setBackendAvailable(false);
            const fsJoined = await joinFirestoreRoom({
              roomCode: normalized,
              displayName: cleanName,
              avatar: selectedAvatar,
            });
            onSuccess({
              ...fsJoined,
              isNewlyCreated: false,
              transportMode: 'firestore',
            });
            return;
          }

          if (!res.ok || !res.data?.room || !res.data?.participantId || !res.data?.token) {
            throw new Error(res.data?.message || 'Unable to join this room.');
          }

          onSuccess({
            room: res.data.room,
            participantId: res.data.participantId,
            role: 'viewer',
            token: res.data.token,
            isNewlyCreated: false,
            transportMode: 'server',
          });
        }
      } else {
        // Static hosting mode (Netlify / Vercel / Firebase Hosting) -> Live Cloud Firestore
        if (activeMode === 'generate') {
          const fsCreated = await createFirestoreRoom({
            displayName: cleanName,
            avatar: selectedAvatar,
            title: roomTitle.trim() || 'Private Watch Room',
            maxParticipants,
          });
          onSuccess({
            ...fsCreated,
            isNewlyCreated: true,
            transportMode: 'firestore',
          });
        } else {
          const normalized = roomIdInput.trim().toUpperCase();
          if (!/^SW-[A-Z0-9]{5}$/.test(normalized)) {
            throw new Error('Enter a valid Room ID in the format SW-XXXXX.');
          }
          const fsJoined = await joinFirestoreRoom({
            roomCode: normalized,
            displayName: cleanName,
            avatar: selectedAvatar,
          });
          onSuccess({
            ...fsJoined,
            isNewlyCreated: false,
            transportMode: 'firestore',
          });
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  const needsGoogleForStaticHost = backendAvailable === false && !profile.isAuthenticated;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-sm p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="room-modal-title"
    >
      <div className="w-full sm:max-w-lg rounded-t-3xl sm:rounded-2xl bg-[#0D1020] border border-white/10 shadow-2xl overflow-hidden max-h-[92vh] flex flex-col">
        <div className="sm:hidden flex justify-center pt-3">
          <div className="w-10 h-1 rounded-full bg-white/20" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-white/[0.06]">
          <div>
            <h2 id="room-modal-title" className="text-lg font-bold text-white font-display">
              {activeMode === 'generate' ? 'Generate Private Team' : 'Join Watch Team'}
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              {activeMode === 'generate'
                ? 'You will be the Room Admin with full playback control.'
                : 'Enter a Room ID or use your friend’s invitation link.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="min-w-[40px] min-h-[40px] rounded-xl bg-white/[0.05] hover:bg-white/[0.1] text-slate-300 flex items-center justify-center transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Segmented Mode Switch */}
        <div className="px-6 pt-4">
          <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-[#06070D] border border-white/[0.06]">
            <button
              type="button"
              onClick={() => {
                setActiveMode('generate');
                setError(null);
              }}
              className={`min-h-[40px] rounded-lg text-sm font-semibold transition-colors cursor-pointer ${
                activeMode === 'generate'
                  ? 'bg-violet-600 text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Generate Team
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveMode('join');
                setError(null);
              }}
              className={`min-h-[40px] rounded-lg text-sm font-semibold transition-colors cursor-pointer ${
                activeMode === 'join'
                  ? 'bg-violet-600 text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Join Team
            </button>
          </div>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5 overflow-y-auto">
          {/* Static Host (Netlify) 1-Click Google Auth Gate for Live Firestore Sync */}
          {needsGoogleForStaticHost && (
            <div className="p-4 rounded-xl bg-violet-500/10 border border-violet-500/30 space-y-3">
              <p className="text-xs text-violet-100 leading-relaxed">
                This deployment runs in serverless Cloud Firestore mode. Sign in once with Google
                to create or join live watch rooms securely.
              </p>
              <button
                type="button"
                disabled={authBusy}
                onClick={() => void handleGoogleSignInInline()}
                className="w-full min-h-[44px] px-4 rounded-xl bg-white text-slate-950 hover:bg-slate-100 text-sm font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                {authBusy ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <LogIn className="w-4 h-4" />
                )}
                Continue with Google
              </button>
            </div>
          )}

          {/* Join Room ID Input & Live Preview */}
          {activeMode === 'join' && (
            <div className="space-y-3">
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-slate-300">Room ID</span>
                <input
                  type="text"
                  value={roomIdInput}
                  onChange={(e) => setRoomIdInput(e.target.value.toUpperCase())}
                  placeholder="SW-7F3D9"
                  maxLength={12}
                  autoCapitalize="characters"
                  className="w-full min-h-[48px] px-4 rounded-xl bg-[#06070D] border border-white/15 focus:border-violet-500 focus:outline-none text-white font-mono-tabular tracking-widest text-base placeholder:text-slate-600"
                />
              </label>

              {previewLoading && (
                <div className="flex items-center gap-2.5 text-xs text-slate-400 px-1">
                  <Loader2 className="w-4 h-4 animate-spin text-violet-400" />
                  Checking room availability...
                </div>
              )}

              {previewError && (
                <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/25 text-xs text-rose-200">
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  <span>{previewError}</span>
                </div>
              )}

              {preview && (
                <div className="p-4 rounded-xl bg-[#13172C] border border-violet-500/30 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <Avatar avatar={preview.adminAvatar} name={preview.adminName} size="md" ring />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-white truncate">{preview.title}</p>
                        <p className="text-xs text-slate-400 truncate">
                          Hosted by {preview.adminName} · {preview.participantCount}/{preview.maxParticipants}{' '}
                          in room
                        </p>
                      </div>
                    </div>
                    {preview.isLocked && (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-300 shrink-0">
                        <Lock className="w-3.5 h-3.5" />
                        Locked
                      </span>
                    )}
                  </div>

                  {preview.videoSource !== 'none' && (
                    <div className="flex items-center gap-2 text-xs text-violet-200 pt-2 border-t border-white/[0.06]">
                      {preview.videoSource === 'youtube' ? (
                        <Youtube className="w-4 h-4 text-rose-400 shrink-0" />
                      ) : (
                        <Film className="w-4 h-4 text-violet-400 shrink-0" />
                      )}
                      <span className="truncate">
                        Now loaded: {preview.videoTitle || 'Shared Video'}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Display Name */}
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-slate-300">Your Display Name</span>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="e.g., Alex"
              maxLength={40}
              required
              className="w-full min-h-[46px] px-4 rounded-xl bg-[#06070D] border border-white/15 focus:border-violet-500 focus:outline-none text-white text-sm placeholder:text-slate-600"
            />
          </label>

          {/* Avatar Selection */}
          <div className="space-y-2">
            <span className="text-xs font-medium text-slate-300 block">Choose Avatar</span>
            <div className="grid grid-cols-4 sm:grid-cols-8 gap-2.5">
              {AVATAR_OPTIONS.map((opt) => {
                const isSelected = selectedAvatar === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setSelectedAvatar(opt.id)}
                    title={opt.label}
                    className={`relative rounded-full p-0.5 flex items-center justify-center transition-transform cursor-pointer ${
                      isSelected ? 'scale-105' : 'opacity-75 hover:opacity-100'
                    }`}
                  >
                    <Avatar
                      avatar={opt.id}
                      name={displayName || opt.label}
                      size="md"
                      ring={isSelected}
                    />
                    {isSelected && (
                      <span className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-violet-500 text-white flex items-center justify-center border border-[#0D1020]">
                        <Check className="w-2.5 h-2.5" />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Room Creation Options */}
          {activeMode === 'generate' && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <label className="sm:col-span-2 block space-y-1.5">
                <span className="text-xs font-medium text-slate-300">Room Name</span>
                <input
                  type="text"
                  value={roomTitle}
                  onChange={(e) => setRoomTitle(e.target.value)}
                  placeholder="Friday Movie Night"
                  maxLength={80}
                  className="w-full min-h-[44px] px-3.5 rounded-xl bg-[#06070D] border border-white/15 focus:border-violet-500 focus:outline-none text-white text-sm"
                />
              </label>

              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-slate-300">Max People</span>
                <select
                  value={maxParticipants}
                  onChange={(e) => setMaxParticipants(Number(e.target.value))}
                  className="w-full min-h-[44px] px-3 rounded-xl bg-[#06070D] border border-white/15 focus:border-violet-500 focus:outline-none text-white text-sm"
                >
                  <option value={2}>2 (Duo)</option>
                  <option value={4}>4 Friends</option>
                  <option value={6}>6 Friends</option>
                  <option value={8}>8 Friends</option>
                </select>
              </label>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-200">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={
              submitting ||
              needsGoogleForStaticHost ||
              (activeMode === 'join' &&
                (Boolean(preview?.isLocked) ||
                  (preview !== null && preview.participantCount >= preview.maxParticipants)))
            }
            className="w-full min-h-[50px] rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-sm flex items-center justify-center gap-2 transition-all shadow-[0_0_24px_rgba(139,92,246,0.35)] cursor-pointer"
          >
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                {activeMode === 'generate' ? 'Creating Private Room...' : 'Joining Room...'}
              </>
            ) : activeMode === 'generate' ? (
              <>
                <Plus className="w-4 h-4" />
                Create Private Room as Admin
              </>
            ) : (
              <>
                <Users className="w-4 h-4" />
                Join Room as Viewer
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
