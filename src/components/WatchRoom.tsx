import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  Copy,
  Crown,
  Eye,
  LogOut,
  MessageSquare,
  Plus,
  RefreshCw,
  Settings,
  Share2,
  Users,
  WifiOff,
} from 'lucide-react';
import {
  uploadVideoInChunks,
  type LocalVideoMetadata,
} from '../lib/chunkUploader';
import {
  persistRoomEndedToFirestore,
  persistRoomVideoUpdateToFirestore,
} from '../lib/firebase';
import {
  dispatchFirestoreRoomMessage,
  subscribeFirestoreRoom,
} from '../lib/firestoreRooms';
import {
  AdminWebRtcManager,
  captureMediaStreamFromVideo,
  fetchRtcConfig,
  ViewerWebRtcManager,
  type PeerConnectionStatus,
} from '../lib/webrtc';
import type {
  ChatMessage,
  ClientWsMessage,
  ParticipantRole,
  PlaybackCommandAction,
  RoomSettings,
  RoomState,
  ServerWsMessage,
  UserProfileData,
  VideoState,
} from '../shared/types';
import { AddVideoModal } from './AddVideoModal';
import { Avatar } from './Avatar';
import { ChatPanel } from './ChatPanel';
import { InviteModal } from './InviteModal';
import { ParticipantsPanel } from './ParticipantsPanel';
import { RoomSettingsModal } from './RoomSettingsModal';
import { VideoPlayerStage } from './VideoPlayerStage';

interface WatchRoomProps {
  initialRoom: RoomState;
  selfId: string;
  role: ParticipantRole;
  token: string;
  isNewlyCreated: boolean;
  transportMode: 'server' | 'firestore';
  profile: UserProfileData;
  onOpenProfile: () => void;
  onLeaveRoom: () => void;
}

type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'closed';

export function WatchRoom({
  initialRoom,
  selfId,
  role,
  token,
  isNewlyCreated,
  transportMode,
  profile,
  onOpenProfile,
  onLeaveRoom,
}: WatchRoomProps) {
  const isAdmin = role === 'admin';

  const [room, setRoom] = useState<RoomState>(initialRoom);
  const [connState, setConnState] = useState<ConnectionState>('connecting');
  const [clockOffsetMs, setClockOffsetMs] = useState(0);
  const [activeTab, setActiveTab] = useState<'chat' | 'people'>('chat');
  const [unreadCount, setUnreadCount] = useState(0);
  const [deliveredIds, setDeliveredIds] = useState<Set<string>>(() => new Set());
  const [toastError, setToastError] = useState<string | null>(null);
  const [terminatedReason, setTerminatedReason] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState(false);

  // Modals
  const [showAddVideo, setShowAddVideo] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  // Gallery / WebRTC state
  const [hasTurn, setHasTurn] = useState(false);
  const iceServersRef = useRef<RTCIceServer[]>([
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ]);
  const [localGalleryFile, setLocalGalleryFile] = useState<File | null>(null);
  const [localGalleryMeta, setLocalGalleryMeta] = useState<LocalVideoMetadata | null>(null);
  const [remoteMediaStream, setRemoteMediaStream] = useState<MediaStream | null>(null);
  const [webrtcStatus, setWebrtcStatus] = useState<PeerConnectionStatus>('idle');
  const [fallbackNotice, setFallbackNotice] = useState<string | null>(null);
  const [switchingToRelay, setSwitchingToRelay] = useState(false);
  const [relayUploadPercent, setRelayUploadPercent] = useState(0);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);
  const intentionalLeaveRef = useRef(false);
  const adminVideoElRef = useRef<HTMLVideoElement | null>(null);
  const adminRtcRef = useRef<AdminWebRtcManager | null>(null);
  const viewerRtcRef = useRef<ViewerWebRtcManager | null>(null);
  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;

  const roomRef = useRef<RoomState>(room);
  roomRef.current = room;
  const profileRef = useRef<UserProfileData>(profile);
  profileRef.current = profile;

  const sendWs = useCallback(
    (msg: ClientWsMessage) => {
      if (transportMode === 'firestore') {
        void dispatchFirestoreRoomMessage({
          room: roomRef.current,
          selfId,
          role,
          displayName: profileRef.current.displayName,
          avatar: profileRef.current.avatar,
          msg,
        }).catch((err) => {
          setToastError(err instanceof Error ? err.message : 'Unable to sync action.');
          setTimeout(() => setToastError(null), 5000);
        });
        return;
      }
      const sock = wsRef.current;
      if (sock && sock.readyState === WebSocket.OPEN) {
        sock.send(JSON.stringify(msg));
      }
    },
    [transportMode, selfId, role]
  );

  // Load dynamic STUN / optional TURN servers from backend
  useEffect(() => {
    let cancelled = false;
    fetchRtcConfig(token).then((cfg) => {
      if (!cancelled) {
        iceServersRef.current = cfg.iceServers;
        setHasTurn(cfg.hasTurn);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [token]);

  // Setup WebRTC managers for Admin / Viewer
  useEffect(() => {
    if (isAdmin) {
      const mgr = new AdminWebRtcManager({
        iceServers: iceServersRef.current,
        sendSignal: sendWs,
        getStream: () => {
          const el = adminVideoElRef.current;
          if (!el) return null;
          return captureMediaStreamFromVideo(el);
        },
        onPeerStatusChange: (_viewerId, status) => {
          setWebrtcStatus(status);
        },
      });
      adminRtcRef.current = mgr;
      return () => {
        mgr.dispose();
        adminRtcRef.current = null;
      };
    } else {
      const mgr = new ViewerWebRtcManager({
        iceServers: iceServersRef.current,
        sendSignal: sendWs,
        onRemoteStream: (stream) => {
          setRemoteMediaStream(stream);
        },
        onStatusChange: (status) => {
          setWebrtcStatus(status);
        },
      });
      viewerRtcRef.current = mgr;
      return () => {
        mgr.dispose();
        viewerRtcRef.current = null;
      };
    }
  }, [isAdmin, sendWs, hasTurn]);

  // Request WebRTC stream automatically when Viewer sees a Gallery WebRTC video
  useEffect(() => {
    if (
      !isAdmin &&
      connState === 'connected' &&
      room.video.source === 'gallery' &&
      room.video.deliveryMode === 'webrtc'
    ) {
      setRemoteMediaStream(null);
      viewerRtcRef.current?.requestStream();
    } else if (room.video.source !== 'gallery' || room.video.deliveryMode !== 'webrtc') {
      setRemoteMediaStream(null);
      setWebrtcStatus('idle');
    }
  }, [isAdmin, connState, room.video.source, room.video.deliveryMode, room.video.addedAt]);

  // Sync profile edits to active room
  useEffect(() => {
    if (connState === 'connected') {
      sendWs({
        type: 'profile:update',
        displayName: profile.displayName,
        avatar: profile.avatar,
      });
    }
  }, [connState, profile.displayName, profile.avatar, sendWs]);

  // WebSocket Connection + Automatic Reconnection with State Recovery
  const connectSocket = useCallback(() => {
    if (intentionalLeaveRef.current) return;
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      reconnectAttemptRef.current = 0;
      ws.send(JSON.stringify({ type: 'auth', roomId: initialRoom.roomId, token } satisfies ClientWsMessage));
      ws.send(JSON.stringify({ type: 'ping', clientTime: Date.now() } satisfies ClientWsMessage));
    };

    ws.onmessage = (event) => {
      let msg: ServerWsMessage;
      try {
        msg = JSON.parse(String(event.data)) as ServerWsMessage;
      } catch {
        return;
      }

      switch (msg.type) {
        case 'auth:ok': {
          setConnState('connected');
          setClockOffsetMs(msg.serverTime - Date.now());
          setRoom(msg.room);
          break;
        }
        case 'pong': {
          const rtt = Date.now() - msg.clientTime;
          setClockOffsetMs(msg.serverTime - (Date.now() - rtt / 2));
          break;
        }
        case 'room:state': {
          setClockOffsetMs(msg.serverTime - Date.now());
          setRoom(msg.room);
          break;
        }
        case 'participants:update': {
          setRoom((prev) => ({
            ...prev,
            participants: msg.participants,
            adminOnline: msg.adminOnline,
          }));
          break;
        }
        case 'playback:sync': {
          setClockOffsetMs(msg.serverTime - Date.now());
          setRoom((prev) => ({
            ...prev,
            playback: msg.playback,
          }));
          break;
        }
        case 'video:update': {
          setClockOffsetMs(msg.serverTime - Date.now());
          setFallbackNotice(null);
          setRoom((prev) => ({
            ...prev,
            video: msg.video,
            playback: msg.playback,
          }));
          break;
        }
        case 'settings:update': {
          setRoom((prev) => ({
            ...prev,
            settings: msg.settings,
          }));
          break;
        }
        case 'chat:message': {
          setRoom((prev) => {
            // Idempotent deduplication guard
            if (prev.messages.some((m) => m.id === msg.message.id)) {
              return prev;
            }
            return {
              ...prev,
              messages: [...prev.messages, msg.message],
            };
          });
          if (msg.message.senderId !== selfId && activeTabRef.current !== 'chat') {
            setUnreadCount((c) => c + 1);
          }
          break;
        }
        case 'chat:ack': {
          setDeliveredIds((prev) => {
            const next = new Set(prev);
            next.add(msg.clientMessageId);
            return next;
          });
          break;
        }
        case 'chat:reaction': {
          setRoom((prev) => ({
            ...prev,
            messages: prev.messages.map((m) =>
              m.id === msg.messageId ? { ...m, reactions: msg.reactions } : m
            ),
          }));
          break;
        }
        case 'room:kicked': {
          intentionalLeaveRef.current = true;
          setTerminatedReason(msg.reason || 'You were removed from the room by the Admin.');
          setConnState('closed');
          break;
        }
        case 'room:ended': {
          intentionalLeaveRef.current = true;
          setTerminatedReason(msg.reason || 'This watch party was ended by the room Admin.');
          setConnState('closed');
          break;
        }
        case 'error': {
          setToastError(msg.message);
          setTimeout(() => setToastError(null), 5000);
          break;
        }
        // WebRTC signaling events
        case 'webrtc:request-stream': {
          if (isAdmin) {
            void adminRtcRef.current?.handleViewerRequest(msg.fromId);
          }
          break;
        }
        case 'webrtc:offer': {
          if (!isAdmin) {
            void viewerRtcRef.current?.handleOffer(msg.fromId, msg.sdp);
          }
          break;
        }
        case 'webrtc:answer': {
          if (isAdmin) {
            void adminRtcRef.current?.handleAnswer(msg.fromId, msg.sdp);
          }
          break;
        }
        case 'webrtc:ice': {
          if (isAdmin) {
            void adminRtcRef.current?.handleIceCandidate(msg.fromId, msg.candidate);
          } else {
            void viewerRtcRef.current?.handleIceCandidate(msg.candidate);
          }
          break;
        }
        case 'webrtc:fallback-needed': {
          if (isAdmin) {
            setFallbackNotice(
              msg.reason ||
                'Your friend could not connect directly via WebRTC. Switch to Private Chunked Relay.'
            );
          }
          break;
        }
      }
    };

    ws.onclose = () => {
      if (intentionalLeaveRef.current) {
        setConnState('closed');
        return;
      }
      setConnState('reconnecting');
      const delay = Math.min(8000, 1000 * Math.pow(1.6, reconnectAttemptRef.current));
      reconnectAttemptRef.current += 1;
      reconnectTimerRef.current = setTimeout(() => {
        connectSocket();
      }, delay);
    };
  }, [initialRoom.roomId, token, isAdmin, selfId]);

  useEffect(() => {
    intentionalLeaveRef.current = false;

    if (transportMode === 'firestore') {
      setConnState('connecting');
      const unsub = subscribeFirestoreRoom({
        roomId: initialRoom.roomId,
        selfId,
        isAdmin,
        onConnected: () => setConnState('connected'),
        onRoomUpdate: (nextRoom) => {
          setRoom((prev) => {
            if (
              nextRoom.messages.length > prev.messages.length &&
              activeTabRef.current !== 'chat'
            ) {
              const latest = nextRoom.messages[nextRoom.messages.length - 1];
              if (latest && latest.senderId !== selfId) {
                setUnreadCount((c) => c + (nextRoom.messages.length - prev.messages.length));
              }
            }
            return nextRoom;
          });
        },
        onEnded: (reason) => {
          intentionalLeaveRef.current = true;
          setTerminatedReason(reason);
          setConnState('closed');
        },
        onKicked: (reason) => {
          intentionalLeaveRef.current = true;
          setTerminatedReason(reason);
          setConnState('closed');
        },
        onSignal: (sig) => {
          if (sig.signalType === 'request-stream' && isAdmin) {
            void adminRtcRef.current?.handleViewerRequest(sig.fromId);
          } else if (sig.signalType === 'offer' && !isAdmin && sig.payload) {
            void viewerRtcRef.current?.handleOffer(
              sig.fromId,
              sig.payload as RTCSessionDescriptionInit
            );
          } else if (sig.signalType === 'answer' && isAdmin && sig.payload) {
            void adminRtcRef.current?.handleAnswer(
              sig.fromId,
              sig.payload as RTCSessionDescriptionInit
            );
          } else if (sig.signalType === 'ice' && sig.payload) {
            if (isAdmin) {
              void adminRtcRef.current?.handleIceCandidate(
                sig.fromId,
                sig.payload as RTCIceCandidateInit
              );
            } else {
              void viewerRtcRef.current?.handleIceCandidate(sig.payload as RTCIceCandidateInit);
            }
          } else if (sig.signalType === 'fallback-needed' && isAdmin) {
            const reasonObj = sig.payload as { reason?: string } | null;
            setFallbackNotice(
              reasonObj?.reason ||
                'Direct peer connection could not complete across networks.'
            );
          }
        },
      });
      return () => {
        intentionalLeaveRef.current = true;
        unsub();
      };
    }

    connectSocket();
    return () => {
      intentionalLeaveRef.current = true;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close(1000, 'Left room');
      wsRef.current = null;
    };
  }, [transportMode, initialRoom.roomId, selfId, isAdmin, connectSocket]);

  // Handlers
  const handleAdminVideoElementReady = useCallback((el: HTMLVideoElement | null) => {
    adminVideoElRef.current = el;
  }, []);

  const handleAdminPlaybackCommand = useCallback(
    (action: PlaybackCommandAction, position: number, playing: boolean, rate?: number) => {
      if (!isAdmin) return;
      setRoom((prev) => ({
        ...prev,
        playback: {
          playing,
          position,
          rate: rate ?? prev.playback.rate,
          updatedAtServerMs: Date.now() + clockOffsetMs,
        },
      }));
      sendWs({
        type: 'playback:command',
        action,
        position,
        playing,
        rate,
      });
    },
    [isAdmin, clockOffsetMs, sendWs]
  );

  function handleSelectYouTube(video: VideoState) {
    if (!isAdmin) return;
    setLocalGalleryFile(null);
    setLocalGalleryMeta(null);
    setFallbackNotice(null);
    adminRtcRef.current?.dispose();
    sendWs({ type: 'video:set', video });
    void persistRoomVideoUpdateToFirestore({
      roomCode: room.roomId,
      videoSource: 'youtube',
      videoId: video.youtubeId ?? '',
      videoTitle: video.title ?? 'YouTube Video',
      playbackPlaying: false,
      playbackPosition: 0,
      playbackRate: 1,
    }).catch(() => undefined);
  }

  function handleSelectGalleryWebRtc(file: File, meta: LocalVideoMetadata) {
    if (!isAdmin) return;
    setLocalGalleryFile(file);
    setLocalGalleryMeta(meta);
    setFallbackNotice(null);
    const galleryVideo: VideoState = {
      source: 'gallery',
      title: meta.fileName,
      fileName: meta.fileName,
      fileSize: meta.fileSize,
      duration: meta.duration,
      mimeType: meta.mimeType,
      thumbnailUrl: meta.thumbnailUrl,
      deliveryMode: 'webrtc',
      addedAt: Date.now(),
    };
    sendWs({ type: 'video:set', video: galleryVideo });
    void persistRoomVideoUpdateToFirestore({
      roomCode: room.roomId,
      videoSource: 'gallery',
      videoId: 'webrtc-live',
      videoTitle: meta.fileName,
      playbackPlaying: false,
      playbackPosition: 0,
      playbackRate: 1,
    }).catch(() => undefined);
  }

  function handleSelectGalleryRelay(file: File, uploadedVideo: VideoState) {
    if (!isAdmin) return;
    setLocalGalleryFile(file);
    setFallbackNotice(null);
    setRoom((prev) => ({
      ...prev,
      video: uploadedVideo,
      playback: { playing: false, position: 0, rate: 1, updatedAtServerMs: Date.now() },
    }));
    void persistRoomVideoUpdateToFirestore({
      roomCode: room.roomId,
      videoSource: 'gallery',
      videoId: uploadedVideo.mediaId ?? 'relay',
      videoTitle: uploadedVideo.fileName ?? 'Local Movie',
      playbackPlaying: false,
      playbackPosition: 0,
      playbackRate: 1,
    }).catch(() => undefined);
  }

  async function handleSwitchToRelayFallback() {
    if (!isAdmin || !localGalleryFile || !localGalleryMeta || switchingToRelay) return;
    setSwitchingToRelay(true);
    setRelayUploadPercent(0);
    try {
      const res = await uploadVideoInChunks({
        roomId: room.roomId,
        token,
        file: localGalleryFile,
        metadata: localGalleryMeta,
        onProgress: (prog) => setRelayUploadPercent(prog.percent),
      });
      handleSelectGalleryRelay(localGalleryFile, res.video);
    } catch (err) {
      setToastError(err instanceof Error ? err.message : 'Failed to switch to Private Chunked Relay.');
      setTimeout(() => setToastError(null), 5000);
    } finally {
      setSwitchingToRelay(false);
    }
  }

  function handleRemoveVideo() {
    if (!isAdmin) return;
    setLocalGalleryFile(null);
    setLocalGalleryMeta(null);
    setFallbackNotice(null);
    adminRtcRef.current?.dispose();
    sendWs({ type: 'video:remove' });
    void persistRoomVideoUpdateToFirestore({
      roomCode: room.roomId,
      videoSource: 'none',
      videoId: '',
      videoTitle: '',
      playbackPlaying: false,
      playbackPosition: 0,
      playbackRate: 1,
    }).catch(() => undefined);
  }

  function handleSendMessage(text: string) {
    const clientMessageId = `c_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    sendWs({ type: 'chat:send', text, clientMessageId });
  }

  function handleReactMessage(messageId: string, emoji: string) {
    sendWs({ type: 'chat:react', messageId, emoji });
  }

  function handleUpdateSettings(patch: Partial<RoomSettings>) {
    if (!isAdmin) return;
    sendWs({ type: 'room:settings', settings: patch });
  }

  function handleKickParticipant(targetParticipantId: string) {
    if (!isAdmin) return;
    sendWs({ type: 'room:kick', targetParticipantId });
  }

  function handleEndRoom() {
    if (!isAdmin) return;
    sendWs({ type: 'room:end' });
    void persistRoomEndedToFirestore(room.roomId).catch(() => undefined);
    intentionalLeaveRef.current = true;
    onLeaveRoom();
  }

  async function handleCopyRoomId() {
    try {
      await navigator.clipboard.writeText(room.roomId);
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 1800);
    } catch {
      // Ignore
    }
  }

  // Room Ended / Kicked Full-Screen State
  if (terminatedReason) {
    return (
      <div className="min-h-screen bg-[#06070D] text-[#F4F5FA] flex items-center justify-center p-6">
        <div className="w-full max-w-md rounded-2xl bg-[#0D1020] border border-white/10 p-6 sm:p-8 text-center space-y-5">
          <div className="w-12 h-12 rounded-2xl bg-violet-500/15 text-violet-300 flex items-center justify-center mx-auto">
            <AlertCircle className="w-6 h-6" />
          </div>
          <div className="space-y-2">
            <h1 className="text-xl font-bold text-white font-display">Session Ended</h1>
            <p className="text-sm text-slate-400 leading-relaxed">{terminatedReason}</p>
          </div>
          <button
            type="button"
            onClick={onLeaveRoom}
            className="w-full min-h-[48px] rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold transition-colors cursor-pointer"
          >
            Return to SyncWatch Home
          </button>
        </div>
      </div>
    );
  }

  const onlineParticipants = room.participants.filter((p) => p.online);

  return (
    <div className="h-[100dvh] bg-[#06070D] text-[#F4F5FA] flex flex-col overflow-hidden">
      {/* Compact Room Header */}
      <header className="h-14 px-3 sm:px-5 bg-[#090B16]/95 border-b border-white/[0.07] flex items-center justify-between gap-3 shrink-0 pt-safe">
        <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
          <button
            type="button"
            onClick={() => void handleCopyRoomId()}
            title="Copy Room ID"
            className="inline-flex items-center gap-1.5 min-h-[36px] px-2.5 rounded-lg bg-[#13172C] hover:bg-[#1A203D] border border-violet-500/30 text-xs font-mono-tabular font-semibold text-white whitespace-nowrap shrink-0 cursor-pointer"
          >
            {room.roomId}
            {copiedId ? (
              <Check className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <Copy className="w-3.5 h-3.5 text-violet-300" />
            )}
          </button>

          <div className="min-w-0 hidden sm:block">
            <p className="text-sm font-semibold text-white truncate max-w-[200px]">
              {room.settings.title}
            </p>
            <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
              {isAdmin ? (
                <span className="inline-flex items-center gap-1 text-violet-300">
                  <Crown className="w-3 h-3" />
                  Admin
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-slate-300">
                  <Eye className="w-3 h-3" />
                  Viewer
                </span>
              )}
              <span aria-hidden="true">·</span>
              <span className="font-mono-tabular">
                {onlineParticipants.length}/{room.settings.maxParticipants} online
              </span>
            </div>
          </div>
        </div>

        {/* Center/Right: Participant Avatars + Contextual Room Actions */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {/* Participant Avatar Stack in Room Header */}
          <button
            type="button"
            onClick={() => setActiveTab('people')}
            title="View participants"
            className="hidden md:flex items-center -space-x-2 mr-1 cursor-pointer"
          >
            {room.participants.slice(0, 4).map((p) => (
              <Avatar
                key={p.id}
                avatar={p.avatar}
                name={p.displayName}
                size="xs"
                showPresence
                online={p.online}
              />
            ))}
          </button>

          {isAdmin && (
            <button
              type="button"
              onClick={() => setShowAddVideo(true)}
              className="inline-flex items-center gap-1.5 min-h-[38px] px-3 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline">Add Video</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setShowInvite(true)}
            aria-label="Invite friends"
            className="inline-flex items-center gap-1.5 min-w-[38px] min-h-[38px] px-2.5 sm:px-3 rounded-xl bg-white/[0.06] hover:bg-white/[0.11] border border-white/10 text-slate-100 text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Share2 className="w-4 h-4 text-violet-300" />
            <span className="hidden sm:inline">Invite</span>
          </button>

          {isAdmin && (
            <button
              type="button"
              onClick={() => setShowSettings(true)}
              aria-label="Room settings"
              className="min-w-[38px] min-h-[38px] rounded-xl bg-white/[0.06] hover:bg-white/[0.11] border border-white/10 text-slate-200 flex items-center justify-center shrink-0 cursor-pointer"
            >
              <Settings className="w-4 h-4" />
            </button>
          )}

          <button
            type="button"
            onClick={onOpenProfile}
            aria-label="Edit your profile"
            className="min-w-[38px] min-h-[38px] rounded-xl hover:bg-white/[0.08] flex items-center justify-center shrink-0 cursor-pointer"
          >
            <Avatar avatar={profile.avatar} name={profile.displayName} size="xs" />
          </button>

          <button
            type="button"
            onClick={() => {
              intentionalLeaveRef.current = true;
              onLeaveRoom();
            }}
            aria-label="Leave room"
            title="Leave room"
            className="min-w-[38px] min-h-[38px] rounded-xl bg-white/[0.04] hover:bg-rose-500/20 text-slate-300 hover:text-rose-300 flex items-center justify-center shrink-0 cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Network Reconnection Banner */}
      {connState === 'reconnecting' && (
        <div className="px-4 py-2 bg-amber-500/15 border-b border-amber-500/30 flex items-center justify-between gap-3 text-xs text-amber-200 shrink-0">
          <div className="flex items-center gap-2">
            <WifiOff className="w-4 h-4 text-amber-400 shrink-0" />
            <span>Connection interrupted — attempting to reconnect and restore room state...</span>
          </div>
          <button
            type="button"
            onClick={() => connectSocket()}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-500/25 hover:bg-amber-500/35 text-amber-100 font-medium cursor-pointer shrink-0"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Retry
          </button>
        </div>
      )}

      {/* Server Error Toast */}
      {toastError && (
        <div className="px-4 py-2 bg-rose-500/15 border-b border-rose-500/30 flex items-center justify-center gap-2 text-xs text-rose-200 shrink-0">
          <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
          <span>{toastError}</span>
        </div>
      )}

      {/* RESPONSIVE WORKSPACE: Stacked Mobile (Video top, Chat/People bottom) | 2-Column Desktop */}
      <div className="flex-1 flex flex-col lg:flex-row min-h-0 overflow-hidden">
        {/* Left / Top: Cinematic Video Stage */}
        <section className="w-full lg:flex-1 lg:h-full lg:overflow-y-auto bg-[#04050A] flex flex-col justify-center shrink-0 lg:shrink">
          <div className="w-full max-w-[1280px] mx-auto">
            <VideoPlayerStage
              roomId={room.roomId}
              isAdmin={isAdmin}
              isNewlyCreated={isNewlyCreated}
              adminOnline={room.adminOnline}
              video={room.video}
              playback={room.playback}
              clockOffsetMs={clockOffsetMs}
              localGalleryFile={localGalleryFile}
              remoteMediaStream={remoteMediaStream}
              webrtcStatus={webrtcStatus}
              fallbackNotice={fallbackNotice}
              switchingToRelay={switchingToRelay}
              relayUploadPercent={relayUploadPercent}
              onAdminVideoElementReady={handleAdminVideoElementReady}
              onAdminPlaybackCommand={handleAdminPlaybackCommand}
              onOpenAddVideo={() => setShowAddVideo(true)}
              onRemoveVideo={handleRemoveVideo}
              onOpenInvite={() => setShowInvite(true)}
              onRetryWebRtc={() => viewerRtcRef.current?.requestStream()}
              onSwitchToRelayFallback={() => void handleSwitchToRelayFallback()}
            />
          </div>
        </section>

        {/* Right / Bottom: Dedicated Chat & People Panel */}
        <aside className="flex-1 lg:flex-none lg:w-[390px] xl:w-[420px] bg-[#0B0E1B] border-t lg:border-t-0 lg:border-l border-white/[0.07] flex flex-col min-h-0">
          {/* Segmented Chat | People Tabs */}
          <div className="px-3 py-2.5 border-b border-white/[0.06] shrink-0">
            <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-[#06070D] border border-white/[0.06]">
              <button
                type="button"
                onClick={() => {
                  setActiveTab('chat');
                  setUnreadCount(0);
                }}
                className={`min-h-[38px] rounded-lg text-xs font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer ${
                  activeTab === 'chat'
                    ? 'bg-violet-600 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <MessageSquare className="w-4 h-4" />
                Chat
                {unreadCount > 0 && activeTab !== 'chat' && (
                  <span className="font-mono-tabular text-[11px] text-violet-200">
                    ({unreadCount})
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('people')}
                className={`min-h-[38px] rounded-lg text-xs font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer ${
                  activeTab === 'people'
                    ? 'bg-violet-600 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Users className="w-4 h-4" />
                People
                <span className="font-mono-tabular opacity-80">
                  ({room.participants.length})
                </span>
              </button>
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-hidden">
            {activeTab === 'chat' ? (
              <ChatPanel
                messages={room.messages as ChatMessage[]}
                selfId={selfId}
                isAdmin={isAdmin}
                chatEnabled={room.settings.chatEnabled}
                deliveredIds={deliveredIds}
                onSendMessage={handleSendMessage}
                onReactMessage={handleReactMessage}
              />
            ) : (
              <ParticipantsPanel
                participants={room.participants}
                maxParticipants={room.settings.maxParticipants}
                selfId={selfId}
                isAdmin={isAdmin}
                onInvite={() => setShowInvite(true)}
                onKickParticipant={handleKickParticipant}
              />
            )}
          </div>
        </aside>
      </div>

      {/* Modals */}
      {showAddVideo && isAdmin && (
        <AddVideoModal
          roomId={room.roomId}
          token={token}
          hasTurn={hasTurn}
          supportsRelay={transportMode === 'server'}
          onClose={() => setShowAddVideo(false)}
          onSelectYouTube={handleSelectYouTube}
          onSelectGalleryWebRtc={handleSelectGalleryWebRtc}
          onSelectGalleryRelay={handleSelectGalleryRelay}
        />
      )}

      {showInvite && (
        <InviteModal
          roomId={room.roomId}
          roomTitle={room.settings.title}
          onClose={() => setShowInvite(false)}
        />
      )}

      {showSettings && isAdmin && (
        <RoomSettingsModal
          settings={room.settings}
          participants={room.participants}
          selfId={selfId}
          onUpdateSettings={handleUpdateSettings}
          onKickParticipant={handleKickParticipant}
          onOpenAddVideo={() => setShowAddVideo(true)}
          onEndRoom={handleEndRoom}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}
