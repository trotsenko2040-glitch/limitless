import React from 'react';
import { initialsFromNickname } from '../utils/profile';
import './ProfileAvatar.css';

interface ProfileAvatarProps {
  nickname: string;
  avatarDataUrl?: string | null;
  avatarHue?: number | null;
  className?: string;
}

export const ProfileAvatar: React.FC<ProfileAvatarProps> = ({
  nickname,
  avatarDataUrl,
  avatarHue,
  className = '',
}) => {
  const hue = typeof avatarHue === 'number' ? avatarHue : 262;
  const gradientStyle = avatarDataUrl
    ? undefined
    : {
        background: `linear-gradient(135deg, hsla(${hue}, 92%, 66%, 0.96), hsla(${(hue + 44) % 360}, 88%, 52%, 0.92))`,
      };

  return (
    <div className={`profile-avatar ${className}`.trim()} style={gradientStyle} aria-hidden="true">
      {avatarDataUrl ? (
        <img className="profile-avatar-image" src={avatarDataUrl} alt="" />
      ) : (
        <span className="profile-avatar-initials">{initialsFromNickname(nickname)}</span>
      )}
    </div>
  );
};
