import { useState } from 'react';
import {
  ArrowRight,
  Film,
  Lock,
  MessageSquare,
  Play,
  Plus,
  Radio,
  ShieldCheck,
  Users,
  Youtube,
} from 'lucide-react';
import { HERO_CINEMA_IMAGE } from '../lib/avatars';
import type { UserProfileData } from '../shared/types';
import { Avatar } from './Avatar';

interface LandingPageProps {
  profile: UserProfileData;
  onGenerateTeam: () => void;
  onJoinTeam: () => void;
  onOpenProfile: () => void;
}

export function LandingPage({
  profile,
  onGenerateTeam,
  onJoinTeam,
  onOpenProfile,
}: LandingPageProps) {
  const [heroImgFailed, setHeroImgFailed] = useState(false);

  return (
    <div className="min-h-screen bg-[#06070D] text-[#F4F5FA] flex flex-col">
      {/* Subtle radial violet atmosphere at top */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-x-0 top-0 h-[520px] bg-[radial-gradient(ellipse_75%_55%_at_50%_-10%,rgba(124,58,237,0.22),transparent_70%)]"
      />

      {/* Top Navigation — Strict 3-Zone Contract */}
      <header className="sticky top-0 z-30 backdrop-blur-xl bg-[#06070D]/80 border-b border-white/[0.06] pt-safe">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-8">
          {/* Zone 1: Single Brand Wordmark */}
          <a
            href="/"
            onClick={(e) => {
              e.preventDefault();
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            className="inline-flex items-center gap-2.5 text-lg font-bold tracking-tight text-white whitespace-nowrap shrink-0 font-display"
          >
            <span className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-purple-700 flex items-center justify-center shadow-[0_0_20px_rgba(139,92,246,0.45)]">
              <Play className="w-4 h-4 text-white fill-white ml-0.5" />
            </span>
            SyncWatch
          </a>

          {/* Zone 2: Concise single-line text nav links */}
          <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-300">
            <a
              href="#sources"
              className="hover:text-white transition-colors whitespace-nowrap shrink-0"
            >
              Video Sources
            </a>
            <a
              href="#how-it-works"
              className="hover:text-white transition-colors whitespace-nowrap shrink-0"
            >
              How It Works
            </a>
            <a
              href="#controls"
              className="hover:text-white transition-colors whitespace-nowrap shrink-0"
            >
              Admin Control
            </a>
            <a
              href="#privacy"
              className="hover:text-white transition-colors whitespace-nowrap shrink-0"
            >
              Privacy
            </a>
          </nav>

          {/* Zone 3: Single Primary Profile Action */}
          <div className="flex items-center shrink-0">
            <button
              type="button"
              onClick={onOpenProfile}
              className="inline-flex items-center gap-2.5 min-h-[40px] pl-1.5 pr-3.5 py-1.5 rounded-xl bg-white/[0.05] hover:bg-white/[0.09] border border-white/10 text-sm font-medium text-slate-100 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Avatar avatar={profile.avatar} name={profile.displayName} size="xs" />
              <span className="max-w-[110px] truncate">{profile.displayName}</span>
            </button>
          </div>
        </div>
      </header>

      <main className="relative z-10 flex-1">
        {/* Hero Section */}
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-10 pb-16 lg:pt-16 lg:pb-24">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-center">
            <div className="lg:col-span-6 space-y-6">
              <p className="text-sm font-medium text-violet-300 tracking-wide">
                Private Watch Rooms · YouTube &amp; Device Gallery · Real-Time Sync
              </p>

              <h1
                className="font-display font-bold text-white tracking-tight leading-[1.08]"
                style={{ fontSize: 'clamp(2.25rem, 4.4vw, 3.75rem)', textWrap: 'balance' }}
              >
                Watch Together. Chat Together. In Sync.
              </h1>

              <p className="text-base sm:text-lg text-slate-300/90 leading-relaxed max-w-xl">
                Enjoy your favorite YouTube videos and downloaded movies together with friends,
                wherever you are.
              </p>

              {/* Two Prominent Action Buttons */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3.5 pt-2">
                <button
                  type="button"
                  onClick={onGenerateTeam}
                  className="inline-flex items-center justify-center gap-2.5 min-h-[52px] px-7 py-3.5 rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 text-white font-semibold text-sm tracking-wide shadow-[0_0_32px_rgba(139,92,246,0.4)] active:scale-[0.99] transition-all whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Plus className="w-5 h-5" />
                  GENERATE TEAM
                </button>

                <button
                  type="button"
                  onClick={onJoinTeam}
                  className="inline-flex items-center justify-center gap-2.5 min-h-[52px] px-7 py-3.5 rounded-xl bg-[#11152A] hover:bg-[#171C36] border border-violet-500/30 hover:border-violet-400/60 text-white font-semibold text-sm tracking-wide active:scale-[0.99] transition-all whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Users className="w-4 h-4 text-violet-300" />
                  JOIN TEAM
                  <ArrowRight className="w-4 h-4 text-slate-400" />
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs sm:text-sm text-slate-400 pt-1">
                <span>No mandatory sign-up</span>
                <span aria-hidden="true">·</span>
                <span>Invite link or Room ID</span>
                <span aria-hidden="true">·</span>
                <span>Server-enforced Admin controls</span>
              </div>
            </div>

            {/* Dominant Visual Anchor */}
            <div className="lg:col-span-6">
              <div className="relative rounded-2xl overflow-hidden bg-[#0D1020] border border-white/10 shadow-[0_24px_80px_rgba(0,0,0,0.65)] aspect-[16/10]">
                {!heroImgFailed ? (
                  <img
                    src={HERO_CINEMA_IMAGE}
                    alt="SyncWatch private dark cinema lounge"
                    referrerPolicy="no-referrer"
                    onError={() => setHeroImgFailed(true)}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full bg-gradient-to-br from-[#131730] via-[#0B0D1A] to-[#1D1138] flex items-center justify-center">
                    <Play className="w-16 h-16 text-violet-400/60" />
                  </div>
                )}

                <div className="absolute inset-0 bg-gradient-to-t from-[#06070D]/90 via-[#06070D]/25 to-transparent" />

                {/* Clean Cinema Overlay Preview */}
                <div className="absolute inset-x-4 bottom-4 sm:inset-x-6 sm:bottom-6 flex items-end justify-between gap-4">
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-violet-300">Private Cinema Room</p>
                    <p className="text-sm sm:text-base font-semibold text-white">
                      Frame-aligned playback with live friend chat
                    </p>
                  </div>
                  <div className="hidden sm:flex items-center -space-x-2 shrink-0">
                    <Avatar avatar="cosmic" name="Host" size="sm" ring />
                    <Avatar avatar="beats" name="Friend" size="sm" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Section 2: Only Two Video Sources */}
        <section
          id="sources"
          className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14 border-t border-white/[0.06]"
        >
          <div className="max-w-2xl mb-10 space-y-2.5">
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
              Two Dedicated Video Sources
            </h2>
            <p className="text-sm sm:text-base text-slate-400 leading-relaxed">
              Built exclusively for watching YouTube videos or locally downloaded movies straight
              from the Admin&apos;s device gallery.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Source 1: YouTube */}
            <div className="lg:col-span-5 rounded-2xl bg-[#0D1020] border border-white/[0.08] p-6 sm:p-8 flex flex-col justify-between gap-6">
              <div className="space-y-4">
                <div className="w-12 h-12 rounded-xl bg-rose-500/15 text-rose-400 flex items-center justify-center">
                  <Youtube className="w-6 h-6" />
                </div>
                <div className="space-y-2">
                  <h3 className="text-xl font-semibold text-white">01. YouTube</h3>
                  <p className="text-sm text-slate-400 leading-relaxed">
                    Paste any standard YouTube link, shortened youtu.be URL, or embeddable Short.
                    Playback, seeks, and speed stay locked to the Admin through the official
                    YouTube IFrame Player API.
                  </p>
                </div>
              </div>
              <div className="text-xs text-slate-400 flex items-center gap-2.5 pt-4 border-t border-white/[0.06]">
                <span>Standard URLs</span>
                <span aria-hidden="true">·</span>
                <span>youtu.be</span>
                <span aria-hidden="true">·</span>
                <span>YouTube Shorts</span>
              </div>
            </div>

            {/* Source 2: From Gallery */}
            <div className="lg:col-span-7 rounded-2xl bg-[#0D1020] border border-violet-500/25 p-6 sm:p-8 flex flex-col justify-between gap-6 relative overflow-hidden">
              <div
                aria-hidden="true"
                className="pointer-events-none absolute -top-24 -right-24 w-64 h-64 rounded-full bg-violet-600/15 blur-3xl"
              />
              <div className="relative space-y-4">
                <div className="w-12 h-12 rounded-xl bg-violet-500/20 text-violet-300 flex items-center justify-center">
                  <Film className="w-6 h-6" />
                </div>
                <div className="space-y-2">
                  <h3 className="text-xl font-semibold text-white">
                    02. From Gallery (Local Movies)
                  </h3>
                  <p className="text-sm text-slate-300/90 leading-relaxed max-w-2xl">
                    Pick any downloaded MP4, WebM, or MOV movie from your phone, tablet, or
                    computer. SyncWatch streams directly from the Admin to the Viewer via WebRTC
                    peer-to-peer media capture—with an automatic private chunked HTTP Range relay
                    fallback when direct P2P is unavailable.
                  </p>
                </div>
              </div>
              <div className="relative text-xs text-violet-200/80 flex flex-wrap items-center gap-x-3 gap-y-1.5 pt-4 border-t border-white/[0.06]">
                <span>No Viewer file download needed</span>
                <span aria-hidden="true">·</span>
                <span>Zero full-file RAM loading</span>
                <span aria-hidden="true">·</span>
                <span>Private auto-expiring streams</span>
              </div>
            </div>
          </div>
        </section>

        {/* Section 3: How It Works & Admin Authority */}
        <section
          id="how-it-works"
          className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14 border-t border-white/[0.06]"
        >
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8" id="controls">
            <div className="space-y-3">
              <div className="w-10 h-10 rounded-xl bg-white/[0.05] text-violet-300 flex items-center justify-center">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <h3 className="text-lg font-semibold text-white">Admin-Only Authority</h3>
              <p className="text-sm text-slate-400 leading-relaxed">
                The room creator holds exclusive control over play, pause, seeking, playback speed,
                video changes, and room settings—validated on the backend on every command.
              </p>
            </div>

            <div className="space-y-3">
              <div className="w-10 h-10 rounded-xl bg-white/[0.05] text-violet-300 flex items-center justify-center">
                <Radio className="w-5 h-5" />
              </div>
              <h3 className="text-lg font-semibold text-white">Tight Real-Time Sync</h3>
              <p className="text-sm text-slate-400 leading-relaxed">
                Timestamped WebSocket synchronization compensates for network latency and gently
                corrects drift without jarring playback jumps.
              </p>
            </div>

            <div className="space-y-3" id="privacy">
              <div className="w-10 h-10 rounded-xl bg-white/[0.05] text-violet-300 flex items-center justify-center">
                <MessageSquare className="w-5 h-5" />
              </div>
              <h3 className="text-lg font-semibold text-white">Private Rooms &amp; Live Chat</h3>
              <p className="text-sm text-slate-400 leading-relaxed">
                Every room uses a unique private Room ID and invitation link. Chat with emojis and
                reactions alongside the video on mobile or desktop.
              </p>
            </div>
          </div>
        </section>

        {/* Bottom Action Strip */}
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="rounded-2xl bg-[#0D1020] border border-white/[0.08] p-6 sm:p-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 text-xs font-medium text-violet-300">
                <Lock className="w-3.5 h-3.5" />
                Private Invite-Only Rooms
              </div>
              <h2 className="text-2xl font-bold text-white tracking-tight">
                Ready to start movie night?
              </h2>
              <p className="text-sm text-slate-400">
                Create a room in one tap and share your unique invitation link with your friend.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
              <button
                type="button"
                onClick={onGenerateTeam}
                className="flex-1 md:flex-none inline-flex items-center justify-center gap-2 min-h-[48px] px-6 py-3 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                Generate Team
              </button>
              <button
                type="button"
                onClick={onJoinTeam}
                className="flex-1 md:flex-none inline-flex items-center justify-center gap-2 min-h-[48px] px-6 py-3 rounded-xl bg-white/[0.06] hover:bg-white/[0.1] border border-white/10 text-white text-sm font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Join Team
              </button>
            </div>
          </div>
        </section>
      </main>

      {/* Quiet Footer */}
      <footer className="border-t border-white/[0.06] py-8 mt-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500">
          <span>SyncWatch — Private Watch-Together Platform</span>
          <span>Only YouTube &amp; Device Gallery · End-to-End Synchronized Rooms</span>
        </div>
      </footer>
    </div>
  );
}
