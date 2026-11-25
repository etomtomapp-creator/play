import { useState } from 'react';
import {
  AlertTriangle,
  Film,
  Lock,
  MessageSquare,
  Power,
  UserMinus,
  X,
} from 'lucide-react';
import type { Participant, RoomSettings } from '../shared/types';
import { Avatar } from './Avatar';

interface RoomSettingsModalProps {
  settings: RoomSettings;
  participants: Participant[];
  selfId: string;
  onUpdateSettings: (patch: Partial<RoomSettings>) => void;
  onKickParticipant: (participantId: string) => void;
  onOpenAddVideo: () => void;
  onEndRoom: () => void;
  onClose: () => void;
}

export function RoomSettingsModal({
  settings,
  participants,
  selfId,
  onUpdateSettings,
  onKickParticipant,
  onOpenAddVideo,
  onEndRoom,
  onClose,
}: RoomSettingsModalProps) {
  const [titleInput, setTitleInput] = useState(settings.title);
  const [confirmEnd, setConfirmEnd] = useState(false);

  const viewers = participants.filter((p) => p.id !== selfId && p.role !== 'admin');

  function handleSaveTitle(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = titleInput.trim();
    if (trimmed && trimmed !== settings.title) {
      onUpdateSettings({ title: trimmed });
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-sm p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-modal-title"
    >
      <div className="w-full sm:max-w-lg rounded-t-3xl sm:rounded-2xl bg-[#0D1020] border border-white/10 shadow-2xl overflow-hidden max-h-[92vh] flex flex-col">
        <div className="sm:hidden flex justify-center pt-3">
          <div className="w-10 h-1 rounded-full bg-white/20" />
        </div>

        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-white/[0.06]">
          <div>
            <h2 id="settings-modal-title" className="text-lg font-bold text-white font-display">
              Admin Room Settings
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Changes are verified and enforced on the backend.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close room settings"
            className="min-w-[40px] min-h-[40px] rounded-xl bg-white/[0.05] hover:bg-white/[0.1] text-slate-300 flex items-center justify-center cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6 overflow-y-auto pb-safe">
          {/* Room Name */}
          <form onSubmit={handleSaveTitle} className="space-y-2">
            <label className="text-xs font-medium text-slate-300 block">Room Title</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={titleInput}
                onChange={(e) => setTitleInput(e.target.value)}
                maxLength={80}
                className="flex-1 min-h-[44px] px-3.5 rounded-xl bg-[#06070D] border border-white/15 focus:border-violet-500 focus:outline-none text-white text-sm"
              />
              <button
                type="submit"
                disabled={!titleInput.trim() || titleInput.trim() === settings.title}
                className="min-h-[44px] px-4 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
              >
                Save
              </button>
            </div>
          </form>

          {/* Privacy & Chat Toggles */}
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-4 p-4 rounded-xl bg-[#06070D] border border-white/[0.08]">
              <div className="flex items-start gap-3">
                <Lock className="w-5 h-5 text-violet-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-white">Lock Private Room</p>
                  <p className="text-xs text-slate-400">
                    Prevent any new guests from joining via Room ID or link.
                  </p>
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={settings.isLocked}
                onClick={() => onUpdateSettings({ isLocked: !settings.isLocked })}
                className={`relative w-12 h-7 rounded-full transition-colors shrink-0 cursor-pointer ${
                  settings.isLocked ? 'bg-violet-600' : 'bg-white/15'
                }`}
              >
                <span
                  className={`absolute top-1 left-1 w-5 h-5 rounded-full bg-white transition-transform ${
                    settings.isLocked ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            <div className="flex items-center justify-between gap-4 p-4 rounded-xl bg-[#06070D] border border-white/[0.08]">
              <div className="flex items-start gap-3">
                <MessageSquare className="w-5 h-5 text-violet-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-white">Enable Live Chat</p>
                  <p className="text-xs text-slate-400">
                    Allow Viewers to send messages while watching.
                  </p>
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={settings.chatEnabled}
                onClick={() => onUpdateSettings({ chatEnabled: !settings.chatEnabled })}
                className={`relative w-12 h-7 rounded-full transition-colors shrink-0 cursor-pointer ${
                  settings.chatEnabled ? 'bg-violet-600' : 'bg-white/15'
                }`}
              >
                <span
                  className={`absolute top-1 left-1 w-5 h-5 rounded-full bg-white transition-transform ${
                    settings.chatEnabled ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {/* Max Participants */}
            <div className="flex items-center justify-between gap-4 p-4 rounded-xl bg-[#06070D] border border-white/[0.08]">
              <div>
                <p className="text-sm font-semibold text-white">Participant Limit</p>
                <p className="text-xs text-slate-400">Optimized for 2 friends, expandable up to 8.</p>
              </div>
              <select
                value={settings.maxParticipants}
                onChange={(e) => onUpdateSettings({ maxParticipants: Number(e.target.value) })}
                className="min-h-[40px] px-3 rounded-lg bg-[#13172C] border border-white/15 text-sm text-white focus:outline-none focus:border-violet-500"
              >
                <option value={2}>2 People</option>
                <option value={4}>4 People</option>
                <option value={6}>6 People</option>
                <option value={8}>8 People</option>
              </select>
            </div>
          </div>

          {/* Participant Management */}
          <div className="space-y-2.5">
            <p className="text-xs font-medium text-slate-300">
              Manage Viewers ({viewers.length})
            </p>
            {viewers.length === 0 ? (
              <p className="text-xs text-slate-500 p-3.5 rounded-xl bg-[#06070D] border border-white/[0.06]">
                No viewers have joined yet. Share your Room ID to invite your friend.
              </p>
            ) : (
              <div className="space-y-2">
                {viewers.map((v) => (
                  <div
                    key={v.id}
                    className="flex items-center justify-between gap-3 p-3 rounded-xl bg-[#06070D] border border-white/[0.06]"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <Avatar
                        avatar={v.avatar}
                        name={v.displayName}
                        size="sm"
                        showPresence
                        online={v.online}
                      />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-white truncate">{v.displayName}</p>
                        <p className="text-xs text-slate-400">
                          Viewer · {v.online ? 'Online' : 'Offline'}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => onKickParticipant(v.id)}
                      className="inline-flex items-center gap-1.5 min-h-[36px] px-3 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 text-xs font-medium cursor-pointer shrink-0"
                    >
                      <UserMinus className="w-3.5 h-3.5" />
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Quick Actions */}
          <div className="pt-4 border-t border-white/[0.08] space-y-3">
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenAddVideo();
              }}
              className="w-full min-h-[44px] px-4 rounded-xl bg-white/[0.06] hover:bg-white/[0.1] border border-white/10 text-white text-sm font-semibold flex items-center justify-center gap-2 cursor-pointer"
            >
              <Film className="w-4 h-4 text-violet-400" />
              Replace or Add Video
            </button>

            {!confirmEnd ? (
              <button
                type="button"
                onClick={() => setConfirmEnd(true)}
                className="w-full min-h-[44px] px-4 rounded-xl bg-rose-500/12 hover:bg-rose-500/20 border border-rose-500/30 text-rose-300 text-sm font-semibold flex items-center justify-center gap-2 cursor-pointer"
              >
                <Power className="w-4 h-4" />
                End Room for Everyone
              </button>
            ) : (
              <div className="p-4 rounded-xl bg-rose-500/12 border border-rose-500/35 space-y-3">
                <div className="flex items-start gap-2.5 text-xs text-rose-200">
                  <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  <span>
                    Ending this room will disconnect all participants immediately and delete any
                    temporary uploaded media.
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirmEnd(false)}
                    className="flex-1 min-h-[40px] rounded-lg bg-white/10 hover:bg-white/15 text-xs font-semibold text-white cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onEndRoom();
                      onClose();
                    }}
                    className="flex-1 min-h-[40px] rounded-lg bg-rose-600 hover:bg-rose-500 text-xs font-semibold text-white cursor-pointer"
                  >
                    Confirm End Room
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
