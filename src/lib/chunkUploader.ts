import type { VideoState } from '../shared/types';
import { safeReadJson } from './safeFetch';

export interface LocalVideoMetadata {
  fileName: string;
  fileSize: number;
  mimeType: string;
  duration: number;
  width: number;
  height: number;
  thumbnailUrl?: string;
}

/**
 * Extracts duration, dimensions, and a single JPEG thumbnail frame from a local File
 * using an offscreen video element without reading the full file into JS memory.
 */
export function extractVideoMetadata(file: File): Promise<LocalVideoMetadata> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    video.src = objectUrl;

    let settled = false;
    const cleanup = () => {
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(objectUrl);
    };

    const failTimer = setTimeout(() => {
      if (!settled) {
        settled = true;
        cleanup();
        resolve({
          fileName: file.name,
          fileSize: file.size,
          mimeType: file.type || 'video/mp4',
          duration: 0,
          width: 0,
          height: 0,
        });
      }
    }, 8000);

    video.onerror = () => {
      if (settled) return;
      settled = true;
      clearTimeout(failTimer);
      cleanup();
      reject(
        new Error(
          'This video format or codec is not supported by your browser. Try an MP4 (H.264/AAC), WebM, or MOV file.'
        )
      );
    };

    video.onloadedmetadata = () => {
      const seekTarget =
        Number.isFinite(video.duration) && video.duration > 2
          ? Math.min(2, video.duration * 0.15)
          : 0.1;
      try {
        video.currentTime = seekTarget;
      } catch {
        if (!settled) {
          settled = true;
          clearTimeout(failTimer);
          const meta: LocalVideoMetadata = {
            fileName: file.name,
            fileSize: file.size,
            mimeType: file.type || 'video/mp4',
            duration: Number.isFinite(video.duration) ? video.duration : 0,
            width: video.videoWidth,
            height: video.videoHeight,
          };
          cleanup();
          resolve(meta);
        }
      }
    };

    video.onseeked = () => {
      if (settled) return;
      settled = true;
      clearTimeout(failTimer);

      let thumbnailUrl: string | undefined;
      try {
        if (video.videoWidth > 0 && video.videoHeight > 0) {
          const canvas = document.createElement('canvas');
          const maxW = 480;
          const scale = Math.min(1, maxW / video.videoWidth);
          canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
          canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            thumbnailUrl = canvas.toDataURL('image/jpeg', 0.72);
          }
        }
      } catch {
        thumbnailUrl = undefined;
      }

      const meta: LocalVideoMetadata = {
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type || 'video/mp4',
        duration: Number.isFinite(video.duration) ? video.duration : 0,
        width: video.videoWidth,
        height: video.videoHeight,
        thumbnailUrl,
      };
      cleanup();
      resolve(meta);
    };
  });
}

export interface ChunkUploadProgress {
  uploadedBytes: number;
  totalBytes: number;
  percent: number;
  speedBytesPerSec: number;
}

/**
 * Streams a local File to the room's private temporary relay storage in 2MB chunks
 * using File.slice() — never loads the entire movie into JavaScript memory.
 */
export async function uploadVideoInChunks(params: {
  roomId: string;
  token: string;
  file: File;
  metadata: LocalVideoMetadata;
  signal?: AbortSignal;
  onProgress: (progress: ChunkUploadProgress) => void;
}): Promise<{ mediaId: string; streamUrl: string; video: VideoState }> {
  const { roomId, token, file, metadata, signal, onProgress } = params;

  const initRes = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/media/init`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      fileName: metadata.fileName,
      fileSize: file.size,
      mimeType: metadata.mimeType,
      duration: metadata.duration,
      thumbnailUrl: metadata.thumbnailUrl,
    }),
    signal,
  });

  const initParsed = await safeReadJson<{ uploadId?: string; chunkSize?: number; message?: string }>(
    initRes
  );

  if (!initParsed.isJson) {
    throw new Error(
      'Private Chunked Relay requires the SyncWatch Node.js backend server. On static hosting (like Netlify), use Direct Peer Stream (WebRTC).'
    );
  }

  if (!initParsed.ok || !initParsed.data?.uploadId) {
    throw new Error(initParsed.data?.message || 'Unable to initialize private video relay upload.');
  }

  const uploadId = initParsed.data.uploadId;
  const safeChunkSize = Math.max(
    512 * 1024,
    Math.min(initParsed.data.chunkSize || 2 * 1024 * 1024, 3 * 1024 * 1024)
  );

  let offset = 0;
  const startedAt = Date.now();

  while (offset < file.size) {
    if (signal?.aborted) {
      throw new DOMException('Upload cancelled', 'AbortError');
    }

    const end = Math.min(file.size, offset + safeChunkSize);
    const slice = file.slice(offset, end);
    const buffer = await slice.arrayBuffer();

    let uploaded = false;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const chunkRes = await fetch(
          `/api/rooms/${encodeURIComponent(roomId)}/media/${encodeURIComponent(uploadId)}/chunk`,
          {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/octet-stream',
              Authorization: `Bearer ${token}`,
              'x-chunk-offset': String(offset),
            },
            body: buffer,
            signal,
          }
        );

        const chunkParsed = await safeReadJson<{ message?: string }>(chunkRes);
        if (!chunkParsed.ok || !chunkParsed.isJson) {
          throw new Error(chunkParsed.data?.message || `Chunk upload failed (${chunkRes.status})`);
        }
        uploaded = true;
        break;
      } catch (err) {
        if ((err as Error).name === 'AbortError') throw err;
        lastError = err instanceof Error ? err : new Error('Network error uploading chunk');
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
      }
    }

    if (!uploaded) {
      throw lastError ?? new Error('Upload interrupted. Please check your connection and retry.');
    }

    offset = end;
    const elapsedSec = Math.max(0.2, (Date.now() - startedAt) / 1000);
    onProgress({
      uploadedBytes: offset,
      totalBytes: file.size,
      percent: Math.min(100, Math.round((offset / file.size) * 100)),
      speedBytesPerSec: offset / elapsedSec,
    });
  }

  const completeRes = await fetch(
    `/api/rooms/${encodeURIComponent(roomId)}/media/${encodeURIComponent(uploadId)}/complete`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      signal,
    }
  );

  const completeParsed = await safeReadJson<{
    mediaId?: string;
    streamUrl?: string;
    video?: VideoState;
    message?: string;
  }>(completeRes);

  if (!completeParsed.ok || !completeParsed.isJson || !completeParsed.data?.video || !completeParsed.data?.mediaId || !completeParsed.data?.streamUrl) {
    throw new Error(completeParsed.data?.message || 'Failed to finalize private video stream.');
  }

  return {
    mediaId: completeParsed.data.mediaId,
    streamUrl: completeParsed.data.streamUrl,
    video: completeParsed.data.video,
  };
}
