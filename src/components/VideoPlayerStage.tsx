import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  CloudUpload,
  Copy,
  Eye,
  Film,
  Loader2,
  Maximize,
  Minimize,
  Pause,
  Play,
  Plus,
  Radio,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Share2,
  Trash2,
  Volume2,
  VolumeX,
  Youtube,
} from 'lucide-react';
import { useYouTubePlayer } from '../hooks/useYouTubePlayer';
import type { PeerConnectionStatus } from '../lib/webrtc';
import type { PlaybackCommandAction, PlaybackState, VideoState } from '../shared/types';
import { formatFileSize, formatTime } from '../shared/youtube';

interface VideoPlayerStageProps {
  roomId: string;
  isAdmin: boolean;
  isNewlyCreated: boolean;
  adminOnline: boolean;
  video: VideoState;
  playback: PlaybackState;
  clockOffsetMs: number;
  localGalleryFile: File | null;
  remoteMediaStream: MediaStream | null;
  webrtcStatus: PeerConnectionStatus;
  fallbackNotice: string | null;
  switchingToRelay: boolean;
  relayUploadPercent: number;
  onAdminVideoElementReady: (el: HTMLVideoElement | null) => void;
  onAdminPlaybackCommand: (
    action: PlaybackCommandAction,
    position: number,
    playing: boolean,
    rate?: number
  ) => void;
  onOpenAddVideo: () => void;
  onRemoveVideo: () => void;
  onOpenInvite: () => void;
  onRetryWebRtc: () => void;
  onSwitchToRelayFallback: () => void;
}

const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2];

export function VideoPlayerStage({
  roomId,
  isAdmin,
  isNewlyCreated,
  adminOnline,
  video,
  playback,
  clockOffsetMs,
  localGalleryFile,
  remoteMediaStream,
  webrtcStatus,
  fallbackNotice,
  switchingToRelay,
  relayUploadPercent,
  onAdminVideoElementReady,
  onAdminPlaybackCommand,
  onOpenAddVideo,
  onRemoveVideo,
  onOpenInvite,
  onRetryWebRtc,
  onSwitchToRelayFallback,
}: VideoPlayerStageProps) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const ytContainerRef = useRef<HTMLDivElement | null>(null);
  const htmlVideoRef = useRef<HTMLVideoElement | null>(null);

  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isBuffering, setIsBuffering] = useState(false);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const [localObjectUrl, setLocalObjectUrl] = useState<string | null>(null);
  const [videoLoadError, setVideoLoadError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState(false);

  const isSeekingRef = useRef(false);
  const lastRemoteSyncRef = useRef<number>(0);

  // Compute authoritative target time from server playback state
  const getTargetPosition = useCallback(
    (pb: PlaybackState): number => {
      if (!pb.playing) return Math.max(0, pb.position);
      const estimatedServerNow = Date.now() + clockOffsetMs;
      const elapsedSec = Math.max(0, (estimatedServerNow - pb.updatedAtServerMs) / 1000);
      return Math.max(0, pb.position + elapsedSec * pb.rate);
    },
    [clockOffsetMs]
  );

  // Create/revoke Object URL for Admin's local gallery file without loading into RAM
  useEffect(() => {
    if (!localGalleryFile) {
      setLocalObjectUrl(null);
      return;
    }
    const url = URL.createObjectURL(localGalleryFile);
    setLocalObjectUrl(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [localGalleryFile]);

  // Reset local error when video changes
  useEffect(() => {
    setVideoLoadError(null);
    setAutoplayBlocked(false);
    setCurrentTime(0);
    setDuration(video.duration ?? 0);
  }, [video.source, video.youtubeId, video.mediaId, video.addedAt, video.duration]);

  // Track fullscreen changes
  useEffect(() => {
    const onFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  // --- YOUTUBE PLAYER INTEGRATION ---
  const {
    playerRef: ytPlayerRef,
    isReady: ytReady,
    error: ytError,
    duration: ytDuration,
  } = useYouTubePlayer({
    containerRef: ytContainerRef,
    videoId: video.source === 'youtube' ? video.youtubeId : undefined,
    isAdmin,
    onReady: (player) => {
      const target = getTargetPosition(playback);
      if (target > 0.5) {
        player.seekTo(target, true);
      }
      player.setPlaybackRate(playback.rate || 1);
      if (playback.playing) {
        try {
          player.playVideo();
        } catch {
          setAutoplayBlocked(true);
        }
      }
    },
    onAdminStateChange: (state, time) => {
      if (!isAdmin) return;
      if (state === 3) {
        setIsBuffering(true);
      } else {
        setIsBuffering(false);
      }
      // Keep UI synced if YouTube ends naturally
      if (state === 0) {
        onAdminPlaybackCommand('pause', time, false, playback.rate);
      }
    },
  });

  useEffect(() => {
    if (video.source === 'youtube' && ytDuration > 0) {
      setDuration(ytDuration);
    }
  }, [video.source, ytDuration]);

  // Sync Viewer's YouTube player to Admin's authoritative playback state
  useEffect(() => {
    if (video.source !== 'youtube' || !ytReady || !ytPlayerRef.current || isAdmin) return;
    const player = ytPlayerRef.current;
    const target = getTargetPosition(playback);
    const current = player.getCurrentTime();
    const drift = Math.abs(current - target);

    if (player.getPlaybackRate() !== playback.rate) {
      try {
        player.setPlaybackRate(playback.rate);
      } catch {
        // Unsupported speed
      }
    }

    if (drift > 0.85) {
      player.seekTo(target, true);
    }

    const ytState = player.getPlayerState();
    if (playback.playing && ytState !== 1 && ytState !== 3) {
      player.playVideo();
      // Detect browser autoplay block after a short delay
      setTimeout(() => {
        if (ytPlayerRef.current && playback.playing) {
          const postState = ytPlayerRef.current.getPlayerState();
          if (postState === -1 || postState === 5 || postState === 2) {
            setAutoplayBlocked(true);
          }
        }
      }, 900);
    } else if (!playback.playing && ytState === 1) {
      player.pauseVideo();
    }
  }, [video.source, ytReady, isAdmin, playback, getTargetPosition, ytPlayerRef]);

  // --- HTML5 GALLERY VIDEO INTEGRATION (Admin local file / Viewer WebRTC or Relay) ---
  useEffect(() => {
    const el = htmlVideoRef.current;
    if (video.source !== 'gallery' || !el) {
      onAdminVideoElementReady(null);
      return;
    }

    if (isAdmin) {
      const adminSrc = localObjectUrl || video.streamUrl || '';
      if (adminSrc && el.src !== adminSrc) {
        el.srcObject = null;
        el.src = adminSrc;
        el.load();
      }
      onAdminVideoElementReady(el);
      return () => onAdminVideoElementReady(null);
    }

    // Viewer side
    if (video.deliveryMode === 'webrtc') {
      if (remoteMediaStream && el.srcObject !== remoteMediaStream) {
        el.removeAttribute('src');
        el.srcObject = remoteMediaStream;
        el.play().catch(() => {
          setAutoplayBlocked(true);
        });
      }
    } else if (video.deliveryMode === 'relay' && video.streamUrl) {
      if (el.srcObject) el.srcObject = null;
      const absoluteTarget = new URL(video.streamUrl, window.location.origin).href;
      if (el.src !== absoluteTarget) {
        el.src = video.streamUrl;
        el.load();
      }
    }
  }, [
    video.source,
    video.deliveryMode,
    video.streamUrl,
    isAdmin,
    localObjectUrl,
    remoteMediaStream,
    onAdminVideoElementReady,
  ]);

  // Sync Viewer's Gallery Relay video element to Admin's authoritative playback state
  useEffect(() => {
    const el = htmlVideoRef.current;
    if (video.source !== 'gallery' || isAdmin || !el) return;

    if (video.deliveryMode === 'webrtc') {
      // In WebRTC live media stream mode, ensure the live stream element stays playing
      if (remoteMediaStream && el.paused && playback.playing) {
        el.play().catch(() => setAutoplayBlocked(true));
      }
      return;
    }

    // Relay HTTP Range mode — mirror exact Admin position, play/pause, and playbackRate
    const target = getTargetPosition(playback);
    if (Math.abs(el.playbackRate - playback.rate) > 0.01) {
      el.playbackRate = playback.rate;
    }
    const drift = Math.abs(el.currentTime - target);
    const now = Date.now();
    if (drift > 0.75 && now - lastRemoteSyncRef.current > 700 && el.readyState >= 1) {
      lastRemoteSyncRef.current = now;
      try {
        el.currentTime = target;
      } catch {
        // Seek pending metadata
      }
    }

    if (playback.playing && el.paused) {
      el.play().catch(() => setAutoplayBlocked(true));
    } else if (!playback.playing && !el.paused) {
      el.pause();
    }
  }, [video.source, video.deliveryMode, isAdmin, playback, getTargetPosition, remoteMediaStream]);

  // Poll UI timeline + Admin periodic heartbeat sync (every 3.5s while playing)
  useEffect(() => {
    if (video.source === 'none') return;

    const uiInterval = setInterval(() => {
      if (isSeekingRef.current) return;

      if (video.source === 'youtube' && ytPlayerRef.current && ytReady) {
        const t = ytPlayerRef.current.getCurrentTime();
        const d = ytPlayerRef.current.getDuration();
        if (Number.isFinite(t)) setCurrentTime(t);
        if (Number.isFinite(d) && d > 0) setDuration(d);
      } else if (video.source === 'gallery') {
        if (!isAdmin && video.deliveryMode === 'webrtc') {
          // Display authoritative extrapolated position for read-only timeline in WebRTC mode
          setCurrentTime(getTargetPosition(playback));
          if (video.duration && video.duration > 0) setDuration(video.duration);
        } else if (htmlVideoRef.current) {
          setCurrentTime(htmlVideoRef.current.currentTime || 0);
          if (Number.isFinite(htmlVideoRef.current.duration) && htmlVideoRef.current.duration > 0) {
            setDuration(htmlVideoRef.current.duration);
          }
        }
      }
    }, 300);

    let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
    if (isAdmin) {
      heartbeatInterval = setInterval(() => {
        if (!playback.playing) return;
        let pos = 0;
        if (video.source === 'youtube' && ytPlayerRef.current && ytReady) {
          pos = ytPlayerRef.current.getCurrentTime();
        } else if (video.source === 'gallery' && htmlVideoRef.current) {
          pos = htmlVideoRef.current.currentTime;
        }
        onAdminPlaybackCommand('heartbeat', pos, true, playback.rate);
      }, 3500);
    }

    return () => {
      clearInterval(uiInterval);
      if (heartbeatInterval) clearInterval(heartbeatInterval);
    };
  }, [
    video.source,
    video.deliveryMode,
    video.duration,
    isAdmin,
    ytReady,
    ytPlayerRef,
    playback,
    getTargetPosition,
    onAdminPlaybackCommand,
  ]);

  // --- ADMIN PLAYBACK ACTIONS ---
  function getAdminCurrentPosition(): number {
    if (video.source === 'youtube' && ytPlayerRef.current && ytReady) {
      return ytPlayerRef.current.getCurrentTime() || 0;
    }
    if (video.source === 'gallery' && htmlVideoRef.current) {
      return htmlVideoRef.current.currentTime || 0;
    }
    return currentTime;
  }

  function handleTogglePlay() {
    if (!isAdmin) return;
    const pos = getAdminCurrentPosition();
    const nextPlaying = !playback.playing;

    if (video.source === 'youtube' && ytPlayerRef.current && ytReady) {
      if (nextPlaying) ytPlayerRef.current.playVideo();
      else ytPlayerRef.current.pauseVideo();
    } else if (video.source === 'gallery' && htmlVideoRef.current) {
      if (nextPlaying) {
        htmlVideoRef.current.play().catch(() => {
          setVideoLoadError('Unable to start local video playback. Tap play again.');
        });
      } else {
        htmlVideoRef.current.pause();
      }
    }

    onAdminPlaybackCommand(nextPlaying ? 'play' : 'pause', pos, nextPlaying, playback.rate);
  }

  function handleSeekTo(targetSec: number) {
    if (!isAdmin) return;
    const clamped = Math.max(0, duration > 0 ? Math.min(duration, targetSec) : targetSec);
    setCurrentTime(clamped);

    if (video.source === 'youtube' && ytPlayerRef.current && ytReady) {
      ytPlayerRef.current.seekTo(clamped, true);
    } else if (video.source === 'gallery' && htmlVideoRef.current) {
      htmlVideoRef.current.currentTime = clamped;
    }

    onAdminPlaybackCommand('seek', clamped, playback.playing, playback.rate);
  }

  function handleSpeedChange(nextRate: number) {
    if (!isAdmin) return;
    const pos = getAdminCurrentPosition();

    if (video.source === 'youtube' && ytPlayerRef.current && ytReady) {
      ytPlayerRef.current.setPlaybackRate(nextRate);
    } else if (video.source === 'gallery' && htmlVideoRef.current) {
      htmlVideoRef.current.playbackRate = nextRate;
    }

    onAdminPlaybackCommand('rate', pos, playback.playing, nextRate);
  }

  // Local device volume & fullscreen (allowed for both Admin and Viewer locally!)
  function handleVolumeChange(val: number) {
    setVolume(val);
    setMuted(val === 0);
    if (video.source === 'youtube' && ytPlayerRef.current && ytReady) {
      ytPlayerRef.current.setVolume(Math.round(val * 100));
      if (val === 0) ytPlayerRef.current.mute();
      else ytPlayerRef.current.unMute();
    } else if (video.source === 'gallery' && htmlVideoRef.current) {
      htmlVideoRef.current.volume = val;
      htmlVideoRef.current.muted = val === 0;
    }
  }

  function handleToggleMute() {
    const nextMuted = !muted;
    setMuted(nextMuted);
    if (video.source === 'youtube' && ytPlayerRef.current && ytReady) {
      if (nextMuted) ytPlayerRef.current.mute();
      else ytPlayerRef.current.unMute();
    } else if (video.source === 'gallery' && htmlVideoRef.current) {
      htmlVideoRef.current.muted = nextMuted;
    }
  }

  async function handleToggleFullscreen() {
    if (!stageRef.current) return;
    try {
      if (!document.fullscreenElement) {
        await stageRef.current.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch {
      // Fallback for iOS Safari native video fullscreen
      const vid = htmlVideoRef.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
      if (vid && typeof vid.webkitEnterFullscreen === 'function') {
        vid.webkitEnterFullscreen();
      }
    }
  }

  function handleUnlockViewerPlayback() {
    setAutoplayBlocked(false);
    setMuted(false);
    if (video.source === 'youtube' && ytPlayerRef.current && ytReady) {
      ytPlayerRef.current.unMute();
      ytPlayerRef.current.seekTo(getTargetPosition(playback), true);
      if (playback.playing) ytPlayerRef.current.playVideo();
    } else if (video.source === 'gallery' && htmlVideoRef.current) {
      htmlVideoRef.current.muted = false;
      if (video.deliveryMode === 'relay') {
        htmlVideoRef.current.currentTime = getTargetPosition(playback);
      }
      htmlVideoRef.current.play().catch(() => undefined);
    }
  }

  async function handleQuickCopyId() {
    try {
      await navigator.clipboard.writeText(roomId);
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 1800);
    } catch {
      // Ignore
    }
  }

  const progressPct = duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0;

  return (
    <div ref={stageRef} className="w-full bg-[#04050A] flex flex-col">
      {/* Main 16:9 Cinematic Viewport */}
      <div className="relative w-full aspect-video bg-black overflow-hidden">
        {/* EMPTY / ROOM CREATED STATE */}
        {video.source === 'none' && (
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(124,58,237,0.18),rgba(6,7,13,0.96)_72%)] flex flex-col items-center justify-center p-5 sm:p-8 text-center">
            {isAdmin ? (
              <div className="max-w-md w-full space-y-5">
                {isNewlyCreated && (
                  <div className="inline-flex flex-wrap items-center justify-center gap-2 text-xs text-violet-200">
                    <span>Room Ready</span>
                    <span aria-hidden="true">·</span>
                    <button
                      type="button"
                      onClick={() => void handleQuickCopyId()}
                      className="inline-flex items-center gap-1.5 font-mono-tabular font-semibold text-white hover:text-violet-300 cursor-pointer"
                    >
                      {roomId}
                      {copiedId ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="w-3.5 h-3.5 text-violet-400" />
                      )}
                    </button>
                  </div>
                )}

                <div className="space-y-1.5">
                  <h2 className="text-lg sm:text-2xl font-bold text-white font-display">
                    Start Watching Together
                  </h2>
                  <p className="text-xs sm:text-sm text-slate-400">
                    Add a YouTube link or pick a downloaded movie from your device gallery.
                  </p>
                </div>

                <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                  <button
                    type="button"
                    onClick={onOpenAddVideo}
                    className="w-full sm:w-auto inline-flex items-center justify-center gap-2.5 min-h-[50px] px-7 rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 text-white text-sm font-semibold shadow-[0_0_32px_rgba(139,92,246,0.45)] active:scale-[0.98] transition-all cursor-pointer"
                  >
                    <Plus className="w-5 h-5" />
                    Add Video
                  </button>

                  <button
                    type="button"
                    onClick={onOpenInvite}
                    className="w-full sm:w-auto inline-flex items-center justify-center gap-2 min-h-[50px] px-5 rounded-xl bg-white/[0.06] hover:bg-white/[0.11] border border-white/10 text-white text-sm font-medium transition-colors cursor-pointer"
                  >
                    <Share2 className="w-4 h-4 text-violet-300" />
                    Invite Friend
                  </button>
                </div>
              </div>
            ) : (
              <div className="max-w-sm space-y-3">
                <div className="w-12 h-12 rounded-2xl bg-violet-500/15 text-violet-300 flex items-center justify-center mx-auto">
                  <Film className="w-6 h-6" />
                </div>
                <h2 className="text-base sm:text-xl font-bold text-white font-display">
                  Waiting for Room Admin
                </h2>
                <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">
                  The room Admin has not added a video yet. Once they pick a YouTube video or local
                  movie, it will start here automatically in sync.
                </p>
              </div>
            )}
          </div>
        )}

        {/* YOUTUBE STAGE */}
        {video.source === 'youtube' && (
          <>
            <div ref={ytContainerRef} className="w-full h-full" />
            {/* Click shield: prevents Viewer from clicking YT controls and allows Admin tap-to-play */}
            <div
              onClick={isAdmin ? handleTogglePlay : undefined}
              className={`absolute inset-0 z-10 ${isAdmin ? 'cursor-pointer' : 'cursor-default'}`}
              aria-hidden="true"
            />
            {ytError && (
              <div className="absolute inset-0 z-20 bg-[#06070D]/95 flex flex-col items-center justify-center p-6 text-center space-y-4">
                <AlertCircle className="w-10 h-10 text-rose-400" />
                <div className="max-w-md space-y-1.5">
                  <p className="text-base font-semibold text-white">YouTube Playback Unavailable</p>
                  <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">{ytError}</p>
                </div>
                {isAdmin && (
                  <button
                    type="button"
                    onClick={onOpenAddVideo}
                    className="min-h-[42px] px-5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold cursor-pointer"
                  >
                    Choose Another Video
                  </button>
                )}
              </div>
            )}
          </>
        )}

        {/* GALLERY VIDEO STAGE (WebRTC or Private Chunked Relay) */}
        {video.source === 'gallery' && (
          <>
            <video
              ref={htmlVideoRef}
              playsInline
              controls={false}
              disablePictureInPicture={!isAdmin}
              onClick={isAdmin ? handleTogglePlay : undefined}
              onWaiting={() => setIsBuffering(true)}
              onPlaying={() => setIsBuffering(false)}
              onCanPlay={() => setIsBuffering(false)}
              onLoadedMetadata={(e) => {
                const dur = e.currentTarget.duration;
                if (Number.isFinite(dur) && dur > 0) setDuration(dur);
              }}
              onEnded={() => {
                if (isAdmin) {
                  onAdminPlaybackCommand('pause', duration, false, playback.rate);
                }
              }}
              onError={() => {
                setVideoLoadError(
                  'Unable to decode or load this video stream. Try an H.264 MP4 or WebM movie.'
                );
              }}
              className={`w-full h-full object-contain bg-black ${isAdmin ? 'cursor-pointer' : ''}`}
            />

            {/* Viewer WebRTC connecting / error overlay */}
            {!isAdmin && video.deliveryMode === 'webrtc' && !remoteMediaStream && (
              <div className="absolute inset-0 z-20 bg-[#06070D]/90 flex flex-col items-center justify-center p-6 text-center space-y-3">
                {webrtcStatus === 'failed' ? (
                  <>
                    <AlertCircle className="w-9 h-9 text-amber-400" />
                    <p className="text-sm font-semibold text-white">
                      Direct Peer Stream Could Not Connect
                    </p>
                    <p className="text-xs text-slate-400 max-w-sm">
                      Your networks may be blocking direct WebRTC connections. We notified the
                      Admin to switch to Private Chunked Relay, or you can retry P2P.
                    </p>
                    <button
                      type="button"
                      onClick={onRetryWebRtc}
                      className="inline-flex items-center gap-2 min-h-[40px] px-4 rounded-xl bg-violet-600 hover:bg-violet-500 text-xs font-semibold text-white cursor-pointer"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      Retry Peer Stream
                    </button>
                  </>
                ) : (
                  <>
                    <Loader2 className="w-8 h-8 animate-spin text-violet-400" />
                    <p className="text-sm font-semibold text-white">
                      Connecting to Admin&apos;s Live Movie Stream...
                    </p>
                    <p className="text-xs text-slate-400 max-w-xs">
                      Establishing encrypted WebRTC peer connection. No file download required.
                    </p>
                  </>
                )}
              </div>
            )}

            {/* Admin reloaded page without local file in memory (WebRTC mode) */}
            {isAdmin && video.deliveryMode === 'webrtc' && !localObjectUrl && (
              <div className="absolute inset-0 z-20 bg-[#06070D]/92 flex flex-col items-center justify-center p-6 text-center space-y-3">
                <Film className="w-9 h-9 text-violet-400" />
                <p className="text-sm font-semibold text-white">
                  Re-select local video file to resume WebRTC stream
                </p>
                <p className="text-xs text-slate-400 max-w-sm">
                  Browsers clear local file handles on page refresh for privacy. Pick the file
                  again to resume streaming.
                </p>
                <button
                  type="button"
                  onClick={onOpenAddVideo}
                  className="min-h-[42px] px-5 rounded-xl bg-violet-600 hover:bg-violet-500 text-xs font-semibold text-white cursor-pointer"
                >
                  Select Video File
                </button>
              </div>
            )}

            {videoLoadError && (
              <div className="absolute inset-0 z-20 bg-[#06070D]/95 flex flex-col items-center justify-center p-6 text-center space-y-3">
                <AlertCircle className="w-9 h-9 text-rose-400" />
                <p className="text-sm font-semibold text-white">{videoLoadError}</p>
                {isAdmin && (
                  <button
                    type="button"
                    onClick={onOpenAddVideo}
                    className="min-h-[40px] px-4 rounded-xl bg-violet-600 hover:bg-violet-500 text-xs font-semibold text-white cursor-pointer"
                  >
                    Replace Video
                  </button>
                )}
              </div>
            )}
          </>
        )}

        {/* Buffering Spinner */}
        {isBuffering && video.source !== 'none' && !ytError && !videoLoadError && (
          <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-black/30">
            <Loader2 className="w-10 h-10 animate-spin text-violet-400" />
          </div>
        )}

        {/* Browser Autoplay Gesture Prompt for Viewers */}
        {!isAdmin && autoplayBlocked && video.source !== 'none' && (
          <div className="absolute inset-0 z-30 bg-black/75 backdrop-blur-xs flex flex-col items-center justify-center p-5 text-center space-y-3">
            <button
              type="button"
              onClick={handleUnlockViewerPlayback}
              className="inline-flex items-center gap-2.5 min-h-[50px] px-6 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold shadow-[0_0_28px_rgba(139,92,246,0.5)] cursor-pointer"
            >
              <Volume2 className="w-5 h-5" />
              Tap to Sync &amp; Unmute Video
            </button>
            <p className="text-xs text-slate-300">
              Your browser requires one tap to enable synchronized audio playback.
            </p>
          </div>
        )}

        {/* Admin Reconnecting Overlay (preserves state without transferring Admin rights) */}
        {!isAdmin && !adminOnline && (
          <div className="absolute top-3 left-3 right-3 z-30 px-3.5 py-2 rounded-xl bg-amber-500/20 border border-amber-400/40 backdrop-blur-md flex items-center justify-center gap-2 text-xs font-medium text-amber-100">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-300 shrink-0" />
            <span>Room Admin disconnected — waiting for Admin to reconnect. Room state preserved.</span>
          </div>
        )}
      </div>

      {/* Admin WebRTC Fallback Prompt Banner (shown if Viewer cannot connect P2P) */}
      {isAdmin && video.source === 'gallery' && video.deliveryMode === 'webrtc' && (fallbackNotice || switchingToRelay) && (
        <div className="px-4 py-2.5 bg-amber-500/12 border-t border-amber-500/25 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs text-amber-200">
            <CloudUpload className="w-4 h-4 text-amber-400 shrink-0" />
            <span>
              {switchingToRelay
                ? `Uploading private chunks for Relay fallback (${relayUploadPercent}%)...`
                : fallbackNotice}
            </span>
          </div>
          {!switchingToRelay && localGalleryFile && (
            <button
              type="button"
              onClick={onSwitchToRelayFallback}
              className="min-h-[34px] px-3.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
            >
              Switch to Chunked Relay
            </button>
          )}
        </div>
      )}

      {/* PLAYER CONTROL BAR — STRICTLY SPLIT BETWEEN ADMIN AND VIEWER */}
      {video.source !== 'none' && (
        <div className="bg-[#0A0D1A] border-t border-white/[0.07] px-3 sm:px-5 py-3 space-y-2.5">
          {/* Top Metadata Row */}
          <div className="flex items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2 min-w-0">
              {video.source === 'youtube' ? (
                <Youtube className="w-4 h-4 text-rose-400 shrink-0" />
              ) : (
                <Film className="w-4 h-4 text-violet-400 shrink-0" />
              )}
              <span className="font-medium text-white truncate">
                {video.title || video.fileName || 'Shared Video'}
              </span>
              {video.source === 'gallery' && video.fileSize ? (
                <span className="hidden sm:inline text-slate-500 font-mono-tabular shrink-0">
                  · {formatFileSize(video.fileSize)}
                </span>
              ) : null}
              {video.source === 'gallery' && (
                <span className="hidden sm:inline-flex items-center gap-1 text-violet-300 shrink-0">
                  ·
                  {video.deliveryMode === 'webrtc' ? (
                    <>
                      <Radio className="w-3 h-3" />
                      WebRTC Live
                    </>
                  ) : (
                    <>
                      <CloudUpload className="w-3 h-3" />
                      Private Relay
                    </>
                  )}
                </span>
              )}
            </div>

            {isAdmin && (
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={onOpenAddVideo}
                  className="inline-flex items-center gap-1.5 min-h-[32px] px-2.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.11] text-slate-200 text-xs font-medium whitespace-nowrap cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5 text-violet-300" />
                  Change
                </button>
                <button
                  type="button"
                  onClick={onRemoveVideo}
                  title="Remove current video"
                  className="min-w-[32px] min-h-[32px] rounded-lg bg-white/[0.04] hover:bg-rose-500/20 text-slate-400 hover:text-rose-300 flex items-center justify-center cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>

          {isAdmin ? (
            /* ==================== ADMIN INTERACTIVE CONTROLS ==================== */
            <>
              {/* Timeline Scrubber */}
              <div className="flex items-center gap-3">
                <span className="text-[11px] font-mono-tabular text-slate-300 w-11 text-right shrink-0">
                  {formatTime(currentTime)}
                </span>

                <input
                  type="range"
                  aria-label="Seek video timeline"
                  min={0}
                  max={duration > 0 ? duration : 100}
                  step={0.5}
                  value={Math.min(currentTime, duration > 0 ? duration : 100)}
                  onMouseDown={() => {
                    isSeekingRef.current = true;
                  }}
                  onTouchStart={() => {
                    isSeekingRef.current = true;
                  }}
                  onChange={(e) => {
                    setCurrentTime(Number(e.target.value));
                  }}
                  onMouseUp={(e) => {
                    isSeekingRef.current = false;
                    handleSeekTo(Number(e.currentTarget.value));
                  }}
                  onTouchEnd={(e) => {
                    isSeekingRef.current = false;
                    handleSeekTo(Number(e.currentTarget.value));
                  }}
                  onKeyUp={(e) => {
                    handleSeekTo(Number(e.currentTarget.value));
                  }}
                  style={{
                    background: `linear-gradient(to right, #8b5cf6 ${progressPct}%, rgba(255,255,255,0.14) ${progressPct}%)`,
                  }}
                  className="syncwatch-slider flex-1 h-1.5 rounded-full"
                />

                <span className="text-[11px] font-mono-tabular text-slate-400 w-11 shrink-0">
                  {formatTime(duration)}
                </span>
              </div>

              {/* Action Buttons Row */}
              <div className="flex items-center justify-between gap-2 pt-0.5">
                <div className="flex items-center gap-1.5 sm:gap-2">
                  <button
                    type="button"
                    onClick={() => handleSeekTo(currentTime - 10)}
                    aria-label="Seek backward 10 seconds"
                    className="min-w-[40px] min-h-[40px] rounded-xl bg-white/[0.05] hover:bg-white/[0.1] text-slate-200 flex items-center justify-center cursor-pointer"
                  >
                    <RotateCcw className="w-4 h-4" />
                  </button>

                  <button
                    type="button"
                    onClick={handleTogglePlay}
                    aria-label={playback.playing ? 'Pause shared video' : 'Play shared video'}
                    className="min-w-[46px] min-h-[40px] px-4 rounded-xl bg-violet-600 hover:bg-violet-500 text-white flex items-center justify-center gap-1.5 font-semibold text-xs cursor-pointer shadow-[0_0_16px_rgba(139,92,246,0.4)]"
                  >
                    {playback.playing ? (
                      <Pause className="w-4 h-4 fill-white" />
                    ) : (
                      <Play className="w-4 h-4 fill-white ml-0.5" />
                    )}
                    <span className="hidden sm:inline">{playback.playing ? 'Pause' : 'Play'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleSeekTo(currentTime + 10)}
                    aria-label="Seek forward 10 seconds"
                    className="min-w-[40px] min-h-[40px] rounded-xl bg-white/[0.05] hover:bg-white/[0.1] text-slate-200 flex items-center justify-center cursor-pointer"
                  >
                    <RotateCw className="w-4 h-4" />
                  </button>
                </div>

                {/* Volume, Speed & Fullscreen */}
                <div className="flex items-center gap-2">
                  <div className="hidden sm:flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleToggleMute}
                      aria-label={muted ? 'Unmute' : 'Mute'}
                      className="min-w-[36px] min-h-[36px] rounded-lg hover:bg-white/[0.08] text-slate-300 flex items-center justify-center cursor-pointer"
                    >
                      {muted || volume === 0 ? (
                        <VolumeX className="w-4 h-4" />
                      ) : (
                        <Volume2 className="w-4 h-4" />
                      )}
                    </button>
                    <input
                      type="range"
                      aria-label="Volume"
                      min={0}
                      max={1}
                      step={0.05}
                      value={muted ? 0 : volume}
                      onChange={(e) => handleVolumeChange(Number(e.target.value))}
                      style={{
                        background: `linear-gradient(to right, #8b5cf6 ${(muted ? 0 : volume) * 100}%, rgba(255,255,255,0.16) ${(muted ? 0 : volume) * 100}%)`,
                      }}
                      className="syncwatch-slider w-20 h-1 rounded-full"
                    />
                  </div>

                  <select
                    aria-label="Playback speed"
                    value={playback.rate}
                    onChange={(e) => handleSpeedChange(Number(e.target.value))}
                    className="min-h-[36px] px-2 rounded-lg bg-white/[0.05] border border-white/10 text-xs font-mono-tabular text-slate-200 focus:outline-none focus:border-violet-500 cursor-pointer"
                  >
                    {SPEED_OPTIONS.map((spd) => (
                      <option key={spd} value={spd} className="bg-[#0D1020]">
                        {spd}x
                      </option>
                    ))}
                  </select>

                  <button
                    type="button"
                    onClick={() => void handleToggleFullscreen()}
                    aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
                    className="min-w-[40px] min-h-[40px] rounded-xl bg-white/[0.05] hover:bg-white/[0.1] text-slate-200 flex items-center justify-center cursor-pointer"
                  >
                    {isFullscreen ? (
                      <Minimize className="w-4 h-4" />
                    ) : (
                      <Maximize className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>
            </>
          ) : (
            /* ==================== VIEWER READ-ONLY INTERFACE ==================== */
            <div className="space-y-2.5">
              {/* Read-Only Progress Bar (No interaction possible) */}
              <div className="flex items-center gap-3">
                <span className="text-[11px] font-mono-tabular text-slate-300 w-11 text-right shrink-0">
                  {formatTime(currentTime)}
                </span>
                <div className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-violet-500 to-purple-400 transition-all duration-300"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
                <span className="text-[11px] font-mono-tabular text-slate-400 w-11 shrink-0">
                  {formatTime(duration)}
                </span>
              </div>

              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-xs text-slate-300 min-w-0">
                  <Eye className="w-4 h-4 text-violet-400 shrink-0" />
                  <span className="truncate">
                    Viewer Mode — Only the room Admin can control the video.
                  </span>
                </div>

                {/* Local-only speaker volume & fullscreen for Viewer comfort */}
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={handleToggleMute}
                    aria-label={muted ? 'Unmute local audio' : 'Mute local audio'}
                    className="min-w-[38px] min-h-[38px] rounded-lg bg-white/[0.05] hover:bg-white/[0.1] text-slate-200 flex items-center justify-center cursor-pointer"
                  >
                    {muted || volume === 0 ? (
                      <VolumeX className="w-4 h-4" />
                    ) : (
                      <Volume2 className="w-4 h-4" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleToggleFullscreen()}
                    aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
                    className="min-w-[38px] min-h-[38px] rounded-lg bg-white/[0.05] hover:bg-white/[0.1] text-slate-200 flex items-center justify-center cursor-pointer"
                  >
                    {isFullscreen ? (
                      <Minimize className="w-4 h-4" />
                    ) : (
                      <Maximize className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
