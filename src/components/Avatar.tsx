import { useState } from 'react';
import { getInitials, resolveAvatarOption } from '../lib/avatars';

interface AvatarProps {
  avatar: string;
  name: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  online?: boolean;
  showPresence?: boolean;
  ring?: boolean;
  className?: string;
}

const SIZE_CLASSES: Record<NonNullable<AvatarProps['size']>, string> = {
  xs: 'w-7 h-7 text-[11px]',
  sm: 'w-8 h-8 text-xs',
  md: 'w-10 h-10 text-sm',
  lg: 'w-12 h-12 text-base',
  xl: 'w-16 h-16 text-lg',
};

export function Avatar({
  avatar,
  name,
  size = 'md',
  online,
  showPresence = false,
  ring = false,
  className = '',
}: AvatarProps) {
  const [imgFailed, setImgFailed] = useState(false);
  const preset = resolveAvatarOption(avatar);
  const isExternalUrl = !preset && /^https?:\/\//i.test(avatar);
  const imageSrc = preset?.type === 'image' ? preset.src : isExternalUrl ? avatar : undefined;
  const gradient = preset?.gradient ?? 'from-violet-600 via-purple-700 to-indigo-900';

  return (
    <div className={`relative inline-flex shrink-0 ${className}`}>
      <div
        className={`${SIZE_CLASSES[size]} rounded-full overflow-hidden flex items-center justify-center font-semibold text-white select-none bg-gradient-to-br ${gradient} ${
          ring ? 'ring-2 ring-violet-500/80 ring-offset-2 ring-offset-[#0D1020]' : 'border border-white/10'
        }`}
      >
        {imageSrc && !imgFailed ? (
          <img
            src={imageSrc}
            alt={`${name} avatar`}
            referrerPolicy="no-referrer"
            onError={() => setImgFailed(true)}
            className="w-full h-full object-cover"
          />
        ) : (
          <span>{getInitials(name)}</span>
        )}
      </div>

      {showPresence && (
        <span
          title={online ? 'Online' : 'Offline'}
          className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-[#0D1020] ${
            online ? 'bg-emerald-400' : 'bg-slate-500'
          }`}
        />
      )}
    </div>
  );
}
