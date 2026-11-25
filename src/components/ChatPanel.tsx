import { useEffect, useRef, useState } from 'react';
import { Check, CheckCheck, Lock, Send, Smile } from 'lucide-react';
import type { ChatMessage } from '../shared/types';
import { Avatar } from './Avatar';

interface ChatPanelProps {
  messages: ChatMessage[];
  selfId: string;
  isAdmin: boolean;
  chatEnabled: boolean;
  deliveredIds: Set<string>;
  onSendMessage: (text: string) => void;
  onReactMessage: (messageId: string, emoji: string) => void;
}

const QUICK_EMOJIS = ['😂', '🔥', '❤️', '😮', '👏', '🍿', '😢', '🙌'];

function formatMessageTime(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

export function ChatPanel({
  messages,
  selfId,
  isAdmin,
  chatEnabled,
  deliveredIds,
  onSendMessage,
  onReactMessage,
}: ChatPanelProps) {
  const [draft, setDraft] = useState('');
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [activeReactMessageId, setActiveReactMessageId] = useState<string | null>(null);
  const scrollEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    scrollEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length]);

  const canSend = chatEnabled || isAdmin;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const cleaned = draft.trim();
    if (!cleaned || !canSend) return;
    onSendMessage(cleaned);
    setDraft('');
    setShowEmojiPicker(false);
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Messages List */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 min-h-0">
        {messages.length === 0 ? (
          <div className="h-full min-h-[160px] flex flex-col items-center justify-center text-center px-6 space-y-2">
            <p className="text-sm font-medium text-slate-300">No messages yet</p>
            <p className="text-xs text-slate-500 max-w-[240px]">
              Say hello or drop a reaction while you watch together in sync.
            </p>
          </div>
        ) : (
          messages.map((msg) => {
            const isSelf = msg.senderId === selfId;
            const reactionEntries = Object.entries(msg.reactions || {}).filter(
              ([, users]) => users.length > 0
            );
            const isDelivered = !msg.clientMessageId || deliveredIds.has(msg.clientMessageId) || Boolean(msg.id);

            return (
              <div
                key={msg.id}
                className={`group flex items-start gap-2.5 ${isSelf ? 'flex-row-reverse' : ''}`}
              >
                <Avatar avatar={msg.senderAvatar} name={msg.senderName} size="xs" className="mt-0.5" />

                <div className={`flex flex-col max-w-[80%] ${isSelf ? 'items-end' : 'items-start'}`}>
                  <div
                    className={`flex items-center gap-1.5 text-[11px] text-slate-400 mb-1 ${
                      isSelf ? 'flex-row-reverse' : ''
                    }`}
                  >
                    <span className="font-medium text-slate-300 truncate max-w-[130px]">
                      {isSelf ? 'You' : msg.senderName}
                    </span>
                    {msg.senderRole === 'admin' && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="text-violet-300 font-medium">Admin</span>
                      </>
                    )}
                    <span aria-hidden="true">·</span>
                    <span className="font-mono-tabular text-slate-500">
                      {formatMessageTime(msg.timestamp)}
                    </span>
                  </div>

                  <div className="relative flex items-center gap-1.5">
                    <div
                      onClick={() =>
                        setActiveReactMessageId((prev) => (prev === msg.id ? null : msg.id))
                      }
                      className={`px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed break-words cursor-pointer transition-colors ${
                        isSelf
                          ? 'bg-gradient-to-br from-violet-600 to-purple-600 text-white rounded-tr-sm'
                          : 'bg-[#13172C] text-slate-100 border border-white/[0.06] rounded-tl-sm'
                      }`}
                    >
                      {msg.text}
                    </div>
                  </div>

                  {/* Quick Reaction Tray (click message to open) */}
                  {activeReactMessageId === msg.id && (
                    <div className="mt-1.5 flex items-center gap-1 px-2 py-1 rounded-xl bg-[#0B0E1D] border border-white/10 shadow-lg">
                      {QUICK_EMOJIS.slice(0, 6).map((emoji) => (
                        <button
                          key={emoji}
                          type="button"
                          onClick={() => {
                            onReactMessage(msg.id, emoji);
                            setActiveReactMessageId(null);
                          }}
                          className="w-7 h-7 rounded-lg hover:bg-white/10 flex items-center justify-center text-sm transition-transform active:scale-90 cursor-pointer"
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Active Reactions & Delivery Status */}
                  <div
                    className={`flex flex-wrap items-center gap-1.5 mt-1 ${
                      isSelf ? 'justify-end' : 'justify-start'
                    }`}
                  >
                    {reactionEntries.map(([emoji, userIds]) => {
                      const iReacted = userIds.includes(selfId);
                      return (
                        <button
                          key={emoji}
                          type="button"
                          onClick={() => onReactMessage(msg.id, emoji)}
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs border transition-colors cursor-pointer ${
                            iReacted
                              ? 'bg-violet-500/20 border-violet-400/50 text-white'
                              : 'bg-white/[0.04] border-white/10 text-slate-300 hover:bg-white/[0.08]'
                          }`}
                        >
                          <span>{emoji}</span>
                          <span className="font-mono-tabular text-[11px]">{userIds.length}</span>
                        </button>
                      );
                    })}

                    {isSelf && (
                      <span
                        className="inline-flex items-center gap-0.5 text-[10px] text-slate-500 ml-1"
                        title={isDelivered ? 'Delivered' : 'Sending'}
                      >
                        {isDelivered ? (
                          <CheckCheck className="w-3 h-3 text-violet-400" />
                        ) : (
                          <Check className="w-3 h-3" />
                        )}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={scrollEndRef} />
      </div>

      {/* Emoji Bar */}
      {showEmojiPicker && canSend && (
        <div className="px-4 py-2 border-t border-white/[0.06] bg-[#090B16] flex items-center justify-between gap-1">
          {QUICK_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => setDraft((prev) => `${prev}${emoji}`)}
              className="min-w-[36px] min-h-[36px] rounded-lg hover:bg-white/10 text-base flex items-center justify-center cursor-pointer"
            >
              {emoji}
            </button>
          ))}
        </div>
      )}

      {/* Input Footer */}
      <div className="p-3 border-t border-white/[0.06] bg-[#090B16] pb-safe">
        {!canSend ? (
          <div className="min-h-[44px] px-4 rounded-xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center gap-2 text-xs text-slate-400">
            <Lock className="w-3.5 h-3.5 text-slate-500" />
            Chat is currently paused by the room Admin.
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowEmojiPicker((v) => !v)}
              aria-label="Toggle emoji picker"
              className={`min-w-[44px] min-h-[44px] rounded-xl flex items-center justify-center transition-colors cursor-pointer shrink-0 ${
                showEmojiPicker
                  ? 'bg-violet-500/20 text-violet-300'
                  : 'bg-white/[0.04] hover:bg-white/[0.08] text-slate-400'
              }`}
            >
              <Smile className="w-5 h-5" />
            </button>

            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Send a message..."
              maxLength={600}
              className="flex-1 min-w-0 min-h-[44px] px-3.5 rounded-xl bg-[#06070D] border border-white/10 focus:border-violet-500 focus:outline-none text-sm text-white placeholder:text-slate-500"
            />

            <button
              type="submit"
              disabled={!draft.trim()}
              aria-label="Send message"
              className="min-w-[44px] min-h-[44px] rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white flex items-center justify-center transition-colors cursor-pointer shrink-0"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
