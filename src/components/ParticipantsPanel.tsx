import { Crown, Eye, UserMinus, UserPlus } from 'lucide-react';
import type { Participant } from '../shared/types';
import { Avatar } from './Avatar';

interface ParticipantsPanelProps {
  participants: Participant[];
  maxParticipants: number;
  selfId: string;
  isAdmin: boolean;
  onInvite: () => void;
  onKickParticipant: (participantId: string) => void;
}

export function ParticipantsPanel({
  participants,
  maxParticipants,
  selfId,
  isAdmin,
  onInvite,
  onKickParticipant,
}: ParticipantsPanelProps) {
  const sorted = [...participants].sort((a, b) => {
    if (a.role === 'admin' && b.role !== 'admin') return -1;
    if (b.role === 'admin' && a.role !== 'admin') return 1;
    return a.joinedAt - b.joinedAt;
  });

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-4 py-3 border-b border-white/[0.06] flex items-center justify-between">
        <div className="text-xs text-slate-400">
          Participants ·{' '}
          <span className="font-mono-tabular text-white font-semibold">
            {participants.length}/{maxParticipants}
          </span>
        </div>

        <button
          type="button"
          onClick={onInvite}
          className="inline-flex items-center gap-1.5 min-h-[34px] px-3 rounded-lg bg-violet-600/20 hover:bg-violet-600/30 border border-violet-500/30 text-violet-200 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <UserPlus className="w-3.5 h-3.5" />
          Invite
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-2.5 pb-safe">
        {sorted.map((person) => {
          const isSelf = person.id === selfId;
          const isPersonAdmin = person.role === 'admin';

          return (
            <div
              key={person.id}
              className="flex items-center justify-between gap-3 p-3.5 rounded-xl bg-[#13172C]/70 border border-white/[0.06]"
            >
              <div className="flex items-center gap-3 min-w-0">
                <Avatar
                  avatar={person.avatar}
                  name={person.displayName}
                  size="md"
                  showPresence
                  online={person.online}
                  ring={isPersonAdmin}
                />

                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white truncate">
                    {person.displayName}{' '}
                    {isSelf && <span className="text-slate-400 font-normal">(You)</span>}
                  </p>
                  <div className="flex items-center gap-2 text-xs mt-0.5">
                    {isPersonAdmin ? (
                      <span className="inline-flex items-center gap-1 text-violet-300 font-medium">
                        <Crown className="w-3.5 h-3.5" />
                        Admin
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-slate-300 font-medium">
                        <Eye className="w-3.5 h-3.5 text-slate-400" />
                        Viewer
                      </span>
                    )}
                    <span aria-hidden="true" className="text-slate-600">
                      ·
                    </span>
                    <span className={person.online ? 'text-emerald-400' : 'text-slate-500'}>
                      {person.online ? 'Online' : 'Reconnecting...'}
                    </span>
                  </div>
                </div>
              </div>

              {isAdmin && !isPersonAdmin && (
                <button
                  type="button"
                  onClick={() => onKickParticipant(person.id)}
                  title={`Remove ${person.displayName}`}
                  className="min-w-[36px] min-h-[36px] rounded-lg bg-white/[0.04] hover:bg-rose-500/20 text-slate-400 hover:text-rose-300 flex items-center justify-center transition-colors cursor-pointer shrink-0"
                >
                  <UserMinus className="w-4 h-4" />
                </button>
              )}
            </div>
          );
        })}

        {participants.length < 2 && (
          <div className="p-4 rounded-xl border border-dashed border-white/10 text-center space-y-2 mt-3">
            <p className="text-xs text-slate-400">Waiting for your friend to join the room.</p>
            <button
              type="button"
              onClick={onInvite}
              className="text-xs font-semibold text-violet-300 hover:text-violet-200 cursor-pointer"
            >
              Share Invite Link
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
