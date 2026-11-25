const YOUTUBE_ID_REGEX = /^[a-zA-Z0-9_-]{11}$/;

export interface ParsedYouTubeUrl {
  videoId: string;
  canonicalUrl: string;
  thumbnailUrl: string;
  isShort: boolean;
}

/**
 * Safely parses standard YouTube URLs, shortened youtu.be links,
 * YouTube Shorts, Live URLs, and embed URLs.
 */
export function parseYouTubeUrl(rawInput: string): ParsedYouTubeUrl | null {
  const trimmed = rawInput.trim();
  if (!trimmed) return null;

  // Support bare 11-char ID if pasted directly
  if (YOUTUBE_ID_REGEX.test(trimmed)) {
    return {
      videoId: trimmed,
      canonicalUrl: `https://www.youtube.com/watch?v=${trimmed}`,
      thumbnailUrl: `https://i.ytimg.com/vi/${trimmed}/hqdefault.jpg`,
      isShort: false,
    };
  }

  let parsed: URL;
  try {
    const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    parsed = new URL(withProtocol);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return null;
  }

  const host = parsed.hostname.toLowerCase().replace(/^www\./, '').replace(/^m\./, '');
  let videoId: string | null = null;
  let isShort = false;

  if (host === 'youtu.be') {
    videoId = parsed.pathname.split('/').filter(Boolean)[0] ?? null;
  } else if (host === 'youtube.com' || host === 'youtube-nocookie.com' || host === 'music.youtube.com') {
    const segments = parsed.pathname.split('/').filter(Boolean);
    if (segments[0] === 'watch') {
      videoId = parsed.searchParams.get('v');
    } else if (segments[0] === 'shorts' && segments[1]) {
      videoId = segments[1];
      isShort = true;
    } else if ((segments[0] === 'embed' || segments[0] === 'live' || segments[0] === 'v') && segments[1]) {
      videoId = segments[1];
    }
  } else {
    return null;
  }

  if (!videoId || !YOUTUBE_ID_REGEX.test(videoId)) {
    return null;
  }

  return {
    videoId,
    canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
    thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    isShort,
  };
}

export function getYouTubeErrorMessage(errorCode: number): string {
  switch (errorCode) {
    case 2:
      return 'Invalid YouTube video ID. Check the link and try again.';
    case 5:
      return 'This video cannot be played in the browser HTML5 player.';
    case 100:
      return 'This YouTube video is private, removed, or unavailable.';
    case 101:
    case 150:
      return 'The video owner has disabled playback on external websites (embedding restricted) or it has age/region limits.';
    default:
      return 'Unable to load this YouTube video. Try another embeddable video.';
  }
}

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let idx = 0;
  let val = bytes;
  while (val >= 1024 && idx < units.length - 1) {
    val /= 1024;
    idx++;
  }
  return `${val.toFixed(idx >= 2 ? 1 : 0)} ${units[idx]}`;
}
