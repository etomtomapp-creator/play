export interface AvatarOption {
  id: string;
  label: string;
  type: 'image' | 'gradient';
  src?: string;
  gradient?: string;
  glyph?: string;
}

export const HERO_CINEMA_IMAGE = '/src/assets/images/hero_watch_cinema_1795633499455.jpg';

export const AVATAR_OPTIONS: AvatarOption[] = [
  {
    id: 'cosmic',
    label: 'Midnight Frame',
    type: 'image',
    src: '/src/assets/images/avatar_cosmic_1795633516571.jpg',
  },
  {
    id: 'beats',
    label: 'Studio Audio',
    type: 'image',
    src: '/src/assets/images/avatar_neon_beats_1795633569351.jpg',
  },
  {
    id: 'cinema',
    label: 'Cinema Lens',
    type: 'image',
    src: '/src/assets/images/avatar_cinema_reel_1795633579376.jpg',
  },
  {
    id: 'violet-orb',
    label: 'Amethyst',
    type: 'gradient',
    gradient: 'from-violet-600 via-purple-600 to-indigo-700',
    glyph: 'SW',
  },
  {
    id: 'indigo-wave',
    label: 'Deep Indigo',
    type: 'gradient',
    gradient: 'from-indigo-600 via-blue-700 to-slate-900',
    glyph: 'IN',
  },
  {
    id: 'orchid-glow',
    label: 'Orchid',
    type: 'gradient',
    gradient: 'from-fuchsia-600 via-purple-700 to-violet-900',
    glyph: 'OR',
  },
  {
    id: 'obsidian-gold',
    label: 'Obsidian',
    type: 'gradient',
    gradient: 'from-slate-700 via-zinc-800 to-neutral-950',
    glyph: 'OB',
  },
  {
    id: 'twilight',
    label: 'Twilight',
    type: 'gradient',
    gradient: 'from-purple-500 via-indigo-600 to-slate-900',
    glyph: 'TW',
  },
];

export function resolveAvatarOption(avatarIdOrUrl: string): AvatarOption | null {
  return AVATAR_OPTIONS.find((item) => item.id === avatarIdOrUrl) ?? null;
}

export function getInitials(name: string): string {
  const cleaned = name.trim();
  if (!cleaned) return 'SW';
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}
