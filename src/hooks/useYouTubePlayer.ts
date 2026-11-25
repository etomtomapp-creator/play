import { useEffect, useRef, useState } from 'react';
import { getYouTubeErrorMessage } from '../shared/youtube';

declare global {
  interface Window {
    YT?: {
      Player: new (
        element: HTMLElement | string,
        options: {
          videoId: string;
          playerVars?: Record<string, string | number>;
          events?: {
            onReady?: (event: { target: YTPlayerInstance }) => void;
            onStateChange?: (event: { data: number; target: YTPlayerInstance }) => void;
            onError?: (event: { data: number }) => void;
          };
        }
      ) => YTPlayerInstance;
      PlayerState: {
        UNSTARTED: number;
        ENDED: number;
        PLAYING: number;
        PAUSED: number;
        BUFFERING: number;
        CUED: number;
      };
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

export interface YTPlayerInstance {
  playVideo: () => void;
  pauseVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead?: boolean) => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  getPlayerState: () => number;
  getPlaybackRate: () => number;
  setPlaybackRate: (rate: number) => void;
  getVolume: () => number;
  setVolume: (vol: number) => void;
  mute: () => void;
  unMute: () => void;
  isMuted: () => boolean;
  loadVideoById: (videoId: string, startSeconds?: number) => void;
  getVideoData?: () => { title?: string; video_id?: string };
  destroy: () => void;
}

let ytApiPromise: Promise<void> | null = null;

function loadYouTubeIframeApi(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.YT && window.YT.Player) return Promise.resolve();
  if (ytApiPromise) return ytApiPromise;

  ytApiPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector('script[src="https://www.youtube.com/iframe_api"]');
    const prevReady = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prevReady?.();
      resolve();
    };

    if (!existing) {
      const script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      script.async = true;
      script.onerror = () => {
        ytApiPromise = null;
        reject(new Error('Failed to load the YouTube IFrame Player API.'));
      };
      document.head.appendChild(script);
    }
  });

  return ytApiPromise;
}

export interface UseYouTubePlayerOptions {
  containerRef: React.RefObject<HTMLDivElement | null>;
  videoId?: string;
  isAdmin: boolean;
  onReady?: (player: YTPlayerInstance, title?: string) => void;
  onAdminStateChange?: (state: number, currentTime: number) => void;
}

export function useYouTubePlayer({
  containerRef,
  videoId,
  isAdmin,
  onReady,
  onAdminStateChange,
}: UseYouTubePlayerOptions) {
  const playerRef = useRef<YTPlayerInstance | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);

  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const onAdminStateChangeRef = useRef(onAdminStateChange);
  onAdminStateChangeRef.current = onAdminStateChange;
  const isAdminRef = useRef(isAdmin);
  isAdminRef.current = isAdmin;

  useEffect(() => {
    if (!videoId || !containerRef.current) {
      setIsReady(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setIsReady(false);
    setError(null);

    const mountNode = document.createElement('div');
    mountNode.className = 'w-full h-full';
    containerRef.current.replaceChildren(mountNode);

    loadYouTubeIframeApi()
      .then(() => {
        if (cancelled || !window.YT) return;
        const player = new window.YT.Player(mountNode, {
          videoId,
          playerVars: {
            autoplay: 0,
            controls: 0, // We provide a clean custom Admin-only cinema control bar and shield Viewers
            disablekb: 1,
            enablejsapi: 1,
            fs: 0,
            iv_load_policy: 3,
            modestbranding: 1,
            playsinline: 1,
            rel: 0,
            origin: window.location.origin,
          },
          events: {
            onReady: (event) => {
              if (cancelled) return;
              playerRef.current = event.target;
              setIsReady(true);
              const dur = event.target.getDuration();
              if (Number.isFinite(dur) && dur > 0) setDuration(dur);
              const title = event.target.getVideoData?.()?.title;
              onReadyRef.current?.(event.target, title);
            },
            onStateChange: (event) => {
              if (cancelled) return;
              const dur = event.target.getDuration();
              if (Number.isFinite(dur) && dur > 0) setDuration(dur);
              if (isAdminRef.current) {
                onAdminStateChangeRef.current?.(event.data, event.target.getCurrentTime());
              }
            },
            onError: (event) => {
              if (cancelled) return;
              setError(getYouTubeErrorMessage(event.data));
            },
          },
        });
        playerRef.current = player;
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Unable to load YouTube player.');
        }
      });

    return () => {
      cancelled = true;
      try {
        playerRef.current?.destroy();
      } catch {
        // Ignore teardown error
      }
      playerRef.current = null;
    };
  }, [videoId, containerRef]);

  return {
    playerRef,
    isReady,
    error,
    duration,
  };
}
