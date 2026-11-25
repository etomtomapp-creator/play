import { useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  CloudUpload,
  Film,
  FolderOpen,
  Link2,
  Loader2,
  Play,
  Radio,
  Trash2,
  X,
  Youtube,
} from 'lucide-react';
import {
  extractVideoMetadata,
  uploadVideoInChunks,
  type ChunkUploadProgress,
  type LocalVideoMetadata,
} from '../lib/chunkUploader';
import { supportsVideoCaptureStream } from '../lib/webrtc';
import type { GalleryDeliveryMode, VideoState } from '../shared/types';
import { formatFileSize, formatTime, parseYouTubeUrl } from '../shared/youtube';

interface AddVideoModalProps {
  roomId: string;
  token: string;
  hasTurn: boolean;
  supportsRelay: boolean;
  onClose: () => void;
  onSelectYouTube: (video: VideoState) => void;
  onSelectGalleryWebRtc: (file: File, metadata: LocalVideoMetadata) => void;
  onSelectGalleryRelay: (file: File, video: VideoState) => void;
}

type ModalStep = 'choose' | 'youtube' | 'gallery';

export function AddVideoModal({
  roomId,
  token,
  hasTurn,
  supportsRelay,
  onClose,
  onSelectYouTube,
  onSelectGalleryWebRtc,
  onSelectGalleryRelay,
}: AddVideoModalProps) {
  const [step, setStep] = useState<ModalStep>('choose');

  // YouTube state
  const [ytInput, setYtInput] = useState('');
  const [ytError, setYtError] = useState<string | null>(null);
  const parsedYt = parseYouTubeUrl(ytInput);

  // Gallery state
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const captureSupported = supportsVideoCaptureStream();

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [metadata, setMetadata] = useState<LocalVideoMetadata | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [galleryError, setGalleryError] = useState<string | null>(null);
  const [deliveryMode, setDeliveryMode] = useState<GalleryDeliveryMode>(
    captureSupported || !supportsRelay ? 'webrtc' : 'relay'
  );
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<ChunkUploadProgress | null>(null);

  function handleYouTubeSubmit(e: React.FormEvent) {
    e.preventDefault();
    setYtError(null);
    const parsed = parseYouTubeUrl(ytInput);
    if (!parsed) {
      setYtError(
        'Please paste a valid YouTube link (youtube.com/watch?v=..., youtu.be/..., or YouTube Shorts).'
      );
      return;
    }

    onSelectYouTube({
      source: 'youtube',
      youtubeId: parsed.videoId,
      title: parsed.isShort ? 'YouTube Short' : 'YouTube Video',
      thumbnailUrl: parsed.thumbnailUrl,
    });
    onClose();
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setGalleryError(null);
    setSelectedFile(file);
    setMetadata(null);
    setAnalyzing(true);

    try {
      const meta = await extractVideoMetadata(file);
      setMetadata(meta);
    } catch (err) {
      setGalleryError(
        err instanceof Error
          ? err.message
          : 'Could not read this video file. Choose a browser-compatible MP4, WebM, or MOV video.'
      );
      setSelectedFile(null);
    } finally {
      setAnalyzing(false);
    }
  }

  function handleClearFile() {
    abortRef.current?.abort();
    setSelectedFile(null);
    setMetadata(null);
    setGalleryError(null);
    setUploading(false);
    setUploadProgress(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }

  async function handleStartGalleryPlayback() {
    if (!selectedFile || !metadata) return;
    setGalleryError(null);

    if (deliveryMode === 'webrtc') {
      if (!captureSupported) {
        setGalleryError(
          'Your browser does not support direct WebRTC video capture. Please switch to Private Chunked Relay below.'
        );
        setDeliveryMode('relay');
        return;
      }
      onSelectGalleryWebRtc(selectedFile, metadata);
      onClose();
      return;
    }

    // Resumable chunked private relay upload
    const controller = new AbortController();
    abortRef.current = controller;
    setUploading(true);
    setUploadProgress({ uploadedBytes: 0, totalBytes: selectedFile.size, percent: 0, speedBytesPerSec: 0 });

    try {
      const result = await uploadVideoInChunks({
        roomId,
        token,
        file: selectedFile,
        metadata,
        signal: controller.signal,
        onProgress: (prog) => setUploadProgress(prog),
      });
      onSelectGalleryRelay(selectedFile, result.video);
      onClose();
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setGalleryError(
          err instanceof Error ? err.message : 'Upload failed. Please retry or use Direct Peer Stream.'
        );
      }
    } finally {
      setUploading(false);
      abortRef.current = null;
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-sm p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-video-title"
    >
      <div className="w-full sm:max-w-lg rounded-t-3xl sm:rounded-2xl bg-[#0D1020] border border-white/10 shadow-2xl overflow-hidden max-h-[92vh] flex flex-col">
        <div className="sm:hidden flex justify-center pt-3">
          <div className="w-10 h-1 rounded-full bg-white/20" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-white/[0.06]">
          <div className="flex items-center gap-2.5 min-w-0">
            {step !== 'choose' && !uploading && (
              <button
                type="button"
                onClick={() => {
                  setStep('choose');
                  setYtError(null);
                  setGalleryError(null);
                }}
                aria-label="Back to video sources"
                className="min-w-[36px] min-h-[36px] rounded-lg bg-white/[0.05] hover:bg-white/[0.1] text-slate-300 flex items-center justify-center cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
            )}
            <div className="min-w-0">
              <h2 id="add-video-title" className="text-lg font-bold text-white font-display">
                {step === 'choose'
                  ? 'Add Video to Room'
                  : step === 'youtube'
                  ? 'Load YouTube Video'
                  : 'Select Movie from Gallery'}
              </h2>
              <p className="text-xs text-slate-400">
                {step === 'choose'
                  ? 'Choose one of the two supported SyncWatch sources.'
                  : step === 'youtube'
                  ? 'Paste a YouTube video, youtu.be link, or Short.'
                  : 'Stream a downloaded movie directly from your device.'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              abortRef.current?.abort();
              onClose();
            }}
            aria-label="Close modal"
            className="min-w-[40px] min-h-[40px] rounded-xl bg-white/[0.05] hover:bg-white/[0.1] text-slate-300 flex items-center justify-center cursor-pointer shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto space-y-5">
          {/* STEP 1: EXACTLY TWO OPTIONS (YouTube | From Gallery) */}
          {step === 'choose' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <button
                type="button"
                onClick={() => setStep('youtube')}
                className="group text-left p-5 rounded-2xl bg-[#13172C] hover:bg-[#191E3A] border border-white/10 hover:border-rose-400/50 transition-all space-y-4 cursor-pointer"
              >
                <div className="w-12 h-12 rounded-xl bg-rose-500/15 text-rose-400 flex items-center justify-center group-hover:scale-105 transition-transform">
                  <Youtube className="w-7 h-7" />
                </div>
                <div className="space-y-1">
                  <p className="text-base font-bold text-white">YouTube</p>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Paste any YouTube URL, youtu.be link, or embeddable Short for instant synced
                    playback.
                  </p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setStep('gallery')}
                className="group text-left p-5 rounded-2xl bg-[#13172C] hover:bg-[#191E3A] border border-violet-500/30 hover:border-violet-400/70 transition-all space-y-4 cursor-pointer"
              >
                <div className="w-12 h-12 rounded-xl bg-violet-500/20 text-violet-300 flex items-center justify-center group-hover:scale-105 transition-transform">
                  <Film className="w-7 h-7" />
                </div>
                <div className="space-y-1">
                  <p className="text-base font-bold text-white">From Gallery</p>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Pick a downloaded MP4, WebM, or MOV video from your device to stream live to
                    your friend.
                  </p>
                </div>
              </button>
            </div>
          )}

          {/* STEP 2A: YOUTUBE URL ENTRY */}
          {step === 'youtube' && (
            <form onSubmit={handleYouTubeSubmit} className="space-y-4">
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-slate-300">YouTube URL</span>
                <div className="relative">
                  <Link2 className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={ytInput}
                    onChange={(e) => {
                      setYtInput(e.target.value);
                      setYtError(null);
                    }}
                    placeholder="https://www.youtube.com/watch?v=..."
                    autoFocus
                    className="w-full min-h-[48px] pl-10 pr-4 rounded-xl bg-[#06070D] border border-white/15 focus:border-violet-500 focus:outline-none text-white text-sm placeholder:text-slate-600"
                  />
                </div>
              </label>

              {parsedYt && (
                <div className="rounded-xl overflow-hidden bg-[#06070D] border border-white/10">
                  <div className="relative aspect-video bg-black">
                    <img
                      src={parsedYt.thumbnailUrl}
                      alt="YouTube video preview"
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-transparent to-transparent" />
                    <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between text-xs text-white">
                      <span className="inline-flex items-center gap-1.5 font-medium">
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                        Valid YouTube {parsedYt.isShort ? 'Short' : 'Video'} detected
                      </span>
                      <span className="font-mono-tabular text-slate-300">{parsedYt.videoId}</span>
                    </div>
                  </div>
                </div>
              )}

              {ytError && (
                <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-200">
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  <span>{ytError}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={!ytInput.trim()}
                className="w-full min-h-[48px] rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 disabled:opacity-45 text-white text-sm font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer"
              >
                <Play className="w-4 h-4 fill-white" />
                Load YouTube Video in Room
              </button>
            </form>
          )}

          {/* STEP 2B: GALLERY FILE SELECTION */}
          {step === 'gallery' && (
            <div className="space-y-4">
              <input
                ref={fileInputRef}
                type="file"
                accept="video/mp4,video/webm,video/quicktime,video/x-m4v,video/x-matroska,video/ogg,.mp4,.webm,.mov,.m4v,.mkv,.ogv,video/*"
                onChange={handleFileChange}
                className="hidden"
              />

              {!selectedFile ? (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full p-8 rounded-2xl border-2 border-dashed border-violet-500/35 hover:border-violet-400/70 bg-[#080A14] hover:bg-[#11152A] transition-colors flex flex-col items-center justify-center gap-3 text-center cursor-pointer"
                >
                  <div className="w-14 h-14 rounded-2xl bg-violet-500/15 text-violet-300 flex items-center justify-center">
                    <FolderOpen className="w-7 h-7" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-white">
                      Choose Video from Device Gallery
                    </p>
                    <p className="text-xs text-slate-400">
                      Supports MP4, WebM, MOV and browser-compatible movies
                    </p>
                  </div>
                </button>
              ) : (
                <div className="rounded-2xl bg-[#080A14] border border-white/10 overflow-hidden">
                  {analyzing ? (
                    <div className="p-6 flex items-center justify-center gap-3 text-sm text-slate-300">
                      <Loader2 className="w-5 h-5 animate-spin text-violet-400" />
                      Reading video metadata &amp; thumbnail...
                    </div>
                  ) : metadata ? (
                    <>
                      {metadata.thumbnailUrl && (
                        <div className="relative aspect-video bg-black">
                          <img
                            src={metadata.thumbnailUrl}
                            alt={metadata.fileName}
                            className="w-full h-full object-contain"
                          />
                        </div>
                      )}
                      <div className="p-4 flex items-start justify-between gap-3">
                        <div className="min-w-0 space-y-1">
                          <p className="text-sm font-semibold text-white truncate">
                            {metadata.fileName}
                          </p>
                          <p className="text-xs text-slate-400 font-mono-tabular">
                            {formatFileSize(metadata.fileSize)}
                            {metadata.duration > 0 ? ` · ${formatTime(metadata.duration)}` : ''}
                            {metadata.width > 0 ? ` · ${metadata.width}x${metadata.height}` : ''}
                          </p>
                        </div>
                        {!uploading && (
                          <button
                            type="button"
                            onClick={handleClearFile}
                            title="Remove selected video"
                            className="min-w-[36px] min-h-[36px] rounded-lg bg-white/[0.05] hover:bg-rose-500/20 text-slate-300 hover:text-rose-300 flex items-center justify-center transition-colors cursor-pointer shrink-0"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </>
                  ) : null}
                </div>
              )}

              {/* Delivery Mode Selection */}
              {selectedFile && metadata && !analyzing && (
                <div className="space-y-2.5">
                  <span className="text-xs font-medium text-slate-300 block">
                    Media Delivery Mode
                  </span>

                  <div className="grid grid-cols-1 gap-2.5">
                    <button
                      type="button"
                      disabled={uploading || !captureSupported}
                      onClick={() => setDeliveryMode('webrtc')}
                      className={`text-left p-3.5 rounded-xl border transition-colors cursor-pointer disabled:opacity-50 ${
                        deliveryMode === 'webrtc'
                          ? 'bg-violet-500/15 border-violet-500/60'
                          : 'bg-[#080A14] border-white/10 hover:border-white/20'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-2 text-sm font-semibold text-white">
                          <Radio className="w-4 h-4 text-violet-400" />
                          Direct Peer Stream (WebRTC)
                        </span>
                        <span className="text-[11px] font-medium text-violet-300">
                          {captureSupported ? 'Instant · No Upload' : 'Unsupported on this browser'}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 mt-1">
                        Streams directly from your browser to your friend in real time. Ideal for
                        large movies on desktop &amp; Android Chrome.
                        {!hasTurn && ' (STUN active; switch to Relay if behind strict firewalls.)'}
                      </p>
                    </button>

                    <button
                      type="button"
                      disabled={uploading || !supportsRelay}
                      onClick={() => setDeliveryMode('relay')}
                      className={`text-left p-3.5 rounded-xl border transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                        deliveryMode === 'relay'
                          ? 'bg-violet-500/15 border-violet-500/60'
                          : 'bg-[#080A14] border-white/10 hover:border-white/20'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-2 text-sm font-semibold text-white">
                          <CloudUpload className="w-4 h-4 text-violet-400" />
                          Private Chunked Relay Fallback
                        </span>
                        <span className="text-[11px] font-medium text-slate-300">
                          {supportsRelay ? 'Works on iOS / All Networks' : 'Requires Node.js Server'}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 mt-1">
                        {supportsRelay
                          ? 'Uploads in 2 MB chunks to private room storage with signed HTTP Range streaming. Auto-deleted when room ends.'
                          : 'Static hosting uses Direct Peer Stream (WebRTC) above. Deploy with server.ts to enable chunked server relay.'}
                      </p>
                    </button>
                  </div>
                </div>
              )}

              {/* Upload Progress */}
              {uploading && uploadProgress && (
                <div className="p-4 rounded-xl bg-[#13172C] border border-violet-500/30 space-y-2.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-white">
                      Uploading private chunks ({uploadProgress.percent}%)
                    </span>
                    <span className="font-mono-tabular text-slate-300">
                      {formatFileSize(uploadProgress.uploadedBytes)} /{' '}
                      {formatFileSize(uploadProgress.totalBytes)}
                    </span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-white/10 overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-violet-500 to-purple-400 transition-all duration-200"
                      style={{ width: `${uploadProgress.percent}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-slate-400">
                    <span>
                      Speed: {formatFileSize(uploadProgress.speedBytesPerSec)}/s
                    </span>
                    <button
                      type="button"
                      onClick={() => abortRef.current?.abort()}
                      className="text-rose-400 hover:text-rose-300 font-medium cursor-pointer"
                    >
                      Cancel Upload
                    </button>
                  </div>
                </div>
              )}

              {galleryError && (
                <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-200">
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  <span>{galleryError}</span>
                </div>
              )}

              {selectedFile && metadata && !analyzing && !uploading && (
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="min-h-[48px] px-4 rounded-xl bg-white/[0.06] hover:bg-white/[0.1] border border-white/10 text-sm font-medium text-slate-200 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Replace
                  </button>
                  <button
                    type="button"
                    onClick={handleStartGalleryPlayback}
                    className="flex-1 min-h-[48px] rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 text-white text-sm font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer"
                  >
                    <Play className="w-4 h-4 fill-white" />
                    {deliveryMode === 'webrtc' ? 'Start Live WebRTC Stream' : 'Upload & Stream Movie'}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
