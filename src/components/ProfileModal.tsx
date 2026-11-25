import { useState } from 'react';
import { Check, Loader2, LogIn, LogOut, Shield, X } from 'lucide-react';
import { AVATAR_OPTIONS } from '../lib/avatars';
import { signInWithGoogle, signOutGoogle } from '../lib/firebase';
import type { UserProfileData } from '../shared/types';
import { Avatar } from './Avatar';

interface ProfileModalProps {
  profile: UserProfileData;
  onSave: (displayName: string, avatar: string) => void;
  onClose: () => void;
}

export function ProfileModal({ profile, onSave, onClose }: ProfileModalProps) {
  const [displayName, setDisplayName] = useState(profile.displayName);
  const [selectedAvatar, setSelectedAvatar] = useState(profile.avatar);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  async function handleGoogleSignIn() {
    setAuthBusy(true);
    setAuthError(null);
    try {
      const user = await signInWithGoogle();
      if (user.displayName && (!displayName.trim() || displayName === 'Guest')) {
        setDisplayName(user.displayName.slice(0, 40));
      }
    } catch (err) {
      setAuthError(
        err instanceof Error ? err.message : 'Unable to sign in with Google right now.'
      );
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleGoogleSignOut() {
    setAuthBusy(true);
    setAuthError(null);
    try {
      await signOutGoogle();
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Failed to sign out.');
    } finally {
      setAuthBusy(false);
    }
  }

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const cleaned = displayName.trim();
    if (!cleaned) return;
    onSave(cleaned, selectedAvatar);
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-sm p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="profile-modal-title"
    >
      <div className="w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl bg-[#0D1020] border border-white/10 shadow-2xl overflow-hidden max-h-[92vh] flex flex-col">
        <div className="sm:hidden flex justify-center pt-3">
          <div className="w-10 h-1 rounded-full bg-white/20" />
        </div>

        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-white/[0.06]">
          <h2 id="profile-modal-title" className="text-lg font-bold text-white font-display">
            Your Profile
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close profile"
            className="min-w-[40px] min-h-[40px] rounded-xl bg-white/[0.05] hover:bg-white/[0.1] text-slate-300 flex items-center justify-center cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSave} className="p-6 space-y-5 overflow-y-auto">
          <div className="flex items-center gap-4">
            <Avatar avatar={selectedAvatar} name={displayName || 'User'} size="xl" ring />
            <div className="min-w-0">
              <p className="text-base font-semibold text-white truncate">
                {displayName.trim() || 'Guest'}
              </p>
              <p className="text-xs text-slate-400 mt-0.5">
                {profile.isAuthenticated
                  ? `Signed in · ${profile.email ?? 'Google Account'}`
                  : 'Guest Profile · Optional account sync'}
              </p>
            </div>
          </div>

          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-slate-300">Display Name</span>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={40}
              required
              className="w-full min-h-[46px] px-4 rounded-xl bg-[#06070D] border border-white/15 focus:border-violet-500 focus:outline-none text-white text-sm"
            />
          </label>

          <div className="space-y-2">
            <span className="text-xs font-medium text-slate-300 block">Select Avatar</span>
            <div className="grid grid-cols-4 gap-3">
              {AVATAR_OPTIONS.map((opt) => {
                const active = selectedAvatar === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setSelectedAvatar(opt.id)}
                    className={`flex flex-col items-center gap-1.5 p-2 rounded-xl border transition-colors cursor-pointer ${
                      active
                        ? 'bg-violet-500/15 border-violet-500/60'
                        : 'bg-white/[0.02] border-white/[0.06] hover:bg-white/[0.05]'
                    }`}
                  >
                    <div className="relative">
                      <Avatar avatar={opt.id} name={displayName || opt.label} size="md" />
                      {active && (
                        <span className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-violet-500 text-white flex items-center justify-center">
                          <Check className="w-2.5 h-2.5" />
                        </span>
                      )}
                    </div>
                    <span className="text-[11px] text-slate-300 truncate max-w-full">
                      {opt.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Optional Firebase Google Authentication */}
          <div className="pt-4 border-t border-white/[0.08] space-y-3">
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <Shield className="w-3.5 h-3.5 text-violet-400" />
              <span>Optional Account Registration (Syncs profile to Cloud Firestore)</span>
            </div>

            {profile.isAuthenticated ? (
              <button
                type="button"
                disabled={authBusy}
                onClick={handleGoogleSignOut}
                className="w-full min-h-[44px] px-4 rounded-xl bg-white/[0.05] hover:bg-white/[0.09] border border-white/10 text-slate-200 text-sm font-medium flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                {authBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogOut className="w-4 h-4" />}
                Sign Out of Google Account
              </button>
            ) : (
              <button
                type="button"
                disabled={authBusy}
                onClick={handleGoogleSignIn}
                className="w-full min-h-[44px] px-4 rounded-xl bg-white/[0.07] hover:bg-white/[0.12] border border-white/15 text-white text-sm font-medium flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                {authBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
                Continue with Google
              </button>
            )}

            {authError && <p className="text-xs text-rose-400">{authError}</p>}
          </div>

          <button
            type="submit"
            className="w-full min-h-[48px] rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold transition-colors cursor-pointer"
          >
            Save Profile
          </button>
        </form>
      </div>
    </div>
  );
}
