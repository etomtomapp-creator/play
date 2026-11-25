import { useState } from 'react';
import { Check, Copy, Link2, Share2, X } from 'lucide-react';

interface InviteModalProps {
  roomId: string;
  roomTitle: string;
  onClose: () => void;
}

export function InviteModal({ roomId, roomTitle, onClose }: InviteModalProps) {
  const inviteUrl = `${window.location.origin}/join/${roomId}`;
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedId, setCopiedId] = useState(false);
  const [shareNote, setShareNote] = useState<string | null>(null);

  async function copyText(text: string, which: 'link' | 'id') {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
    if (which === 'link') {
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    } else {
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 2000);
    }
  }

  async function handleNativeShare() {
    setShareNote(null);
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({
          title: `Join my SyncWatch room — ${roomTitle}`,
          text: `Watch together with me on SyncWatch! Room ID: ${roomId}`,
          url: inviteUrl,
        });
        return;
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
      }
    }
    await copyText(inviteUrl, 'link');
    setShareNote('Invite link copied to clipboard.');
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-sm p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="invite-modal-title"
    >
      <div className="w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl bg-[#0D1020] border border-white/10 shadow-2xl overflow-hidden">
        <div className="sm:hidden flex justify-center pt-3">
          <div className="w-10 h-1 rounded-full bg-white/20" />
        </div>

        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-white/[0.06]">
          <div>
            <h2 id="invite-modal-title" className="text-lg font-bold text-white font-display">
              Invite Friends
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Invite your friend to watch together.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close invite dialog"
            className="min-w-[40px] min-h-[40px] rounded-xl bg-white/[0.05] hover:bg-white/[0.1] text-slate-300 flex items-center justify-center cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-5 pb-safe">
          {/* Room ID Card */}
          <div className="p-4 rounded-2xl bg-[#06070D] border border-violet-500/25 flex items-center justify-between gap-3">
            <div>
              <p className="text-xs text-slate-400">Private Room ID</p>
              <p className="text-2xl font-bold font-mono-tabular tracking-widest text-white mt-0.5">
                {roomId}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void copyText(roomId, 'id')}
              className="inline-flex items-center gap-1.5 min-h-[42px] px-4 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 text-xs font-semibold text-white whitespace-nowrap shrink-0 cursor-pointer"
            >
              {copiedId ? (
                <>
                  <Check className="w-4 h-4 text-emerald-400" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4 text-violet-300" />
                  Copy Room ID
                </>
              )}
            </button>
          </div>

          {/* Invitation URL */}
          <div className="space-y-2">
            <span className="text-xs font-medium text-slate-300 block">Invitation Link</span>
            <div className="flex items-center gap-2 p-2 pl-3.5 rounded-xl bg-[#06070D] border border-white/10">
              <Link2 className="w-4 h-4 text-slate-500 shrink-0" />
              <span className="text-xs text-slate-300 truncate flex-1 font-mono-tabular">
                {inviteUrl}
              </span>
              <button
                type="button"
                onClick={() => void copyText(inviteUrl, 'link')}
                className="inline-flex items-center gap-1.5 min-h-[38px] px-3.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-xs font-semibold text-white whitespace-nowrap shrink-0 cursor-pointer"
              >
                {copiedLink ? (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    Copy Link
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Native Share CTA */}
          <button
            type="button"
            onClick={() => void handleNativeShare()}
            className="w-full min-h-[48px] rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 text-white text-sm font-semibold flex items-center justify-center gap-2 shadow-[0_0_24px_rgba(139,92,246,0.35)] cursor-pointer"
          >
            <Share2 className="w-4 h-4" />
            Share Invitation Link
          </button>

          {shareNote && <p className="text-center text-xs text-emerald-400">{shareNote}</p>}
        </div>
      </div>
    </div>
  );
}
