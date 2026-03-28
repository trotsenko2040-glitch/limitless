import React, { useEffect, useRef, useState } from 'react';
import { ProfileAvatar } from '../components/ProfileAvatar';
import { saveRemoteAccountSnapshot } from '../utils/accountApi';
import { normalizeAccountProfile } from '../utils/profile';
import {
  loadAccountSnapshot,
  loadAuthToken,
  loadOrCreateDeviceId,
  loadProfile,
  saveAccountSnapshot,
} from '../utils/storage';
import './ProfilePage.css';

interface ProfilePageProps {
  onBackHome: () => void;
  onOpenChat: () => void;
}

export const ProfilePage: React.FC<ProfilePageProps> = ({ onBackHome, onOpenChat }) => {
  const authToken = loadAuthToken();
  const [profile, setProfile] = useState(() => loadProfile(authToken));
  const [nickname, setNickname] = useState(profile.nickname);
  const [avatarDataUrl, setAvatarDataUrl] = useState<string | null>(profile.avatarDataUrl);
  const [avatarHue] = useState(profile.avatarHue);
  const [isSaving, setIsSaving] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saved'>('idle');
  const [error, setError] = useState('');
  const avatarInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const nextProfile = loadProfile(authToken);
    setProfile(nextProfile);
    setNickname(nextProfile.nickname);
    setAvatarDataUrl(nextProfile.avatarDataUrl);
  }, [authToken]);

  const handleAvatarUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    if (!file.type.startsWith('image/')) {
      setError('Можно загрузить только изображение для аватара.');
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      setError('Аватар слишком большой. Используйте файл до 2 МБ.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setAvatarDataUrl(reader.result);
        setError('');
      }
    };
    reader.onerror = () => {
      setError('Не удалось прочитать файл аватара.');
    };
    reader.readAsDataURL(file);
  };

  const handleSave = async () => {
    if (!authToken) {
      setError('Профиль недоступен без активного токена.');
      return;
    }

    setIsSaving(true);
    setError('');
    setSaveState('idle');

    const nextProfile = normalizeAccountProfile(
      {
        profileId: profile.profileId,
        nickname,
        avatarDataUrl,
        avatarHue,
      },
      authToken,
    );

    const nextSnapshot = {
      ...loadAccountSnapshot(authToken),
      profile: nextProfile,
    };

    saveAccountSnapshot(nextSnapshot, authToken);
    setProfile(nextProfile);

    try {
      await saveRemoteAccountSnapshot(authToken, loadOrCreateDeviceId(), nextSnapshot);
      setSaveState('saved');
    } catch {
      setError('Локально профиль сохранен, но сервер сейчас недоступен.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="profile-page">
      <div className="profile-orb profile-orb-1" />
      <div className="profile-orb profile-orb-2" />

      <div className="profile-shell">
        <div className="profile-topbar">
          <button type="button" className="profile-nav-btn" onClick={onBackHome}>
            На главную
          </button>
          <button type="button" className="profile-nav-btn profile-nav-btn-primary" onClick={onOpenChat}>
            В чат
          </button>
        </div>

        <section className="profile-card">
          <div className="profile-card-head">
            <div className="profile-badge">PROFILE</div>
            <h1 className="profile-title">Профиль Limitless</h1>
            <p className="profile-subtitle">Здесь можно поменять ник и аватар. Ваш ID остается постоянным.</p>
          </div>

          <div className="profile-main">
            <div className="profile-preview">
              <ProfileAvatar
                className="profile-preview-avatar"
                nickname={nickname}
                avatarDataUrl={avatarDataUrl}
                avatarHue={avatarHue}
                fallback="silhouette"
              />

              <div className="profile-preview-copy">
                <div className="profile-preview-name">{nickname.trim() || profile.nickname}</div>
                <div className="profile-preview-id">{profile.profileId}</div>
              </div>

              <div className="profile-preview-actions">
                <button type="button" className="profile-action-btn" onClick={() => avatarInputRef.current?.click()}>
                  Загрузить фото
                </button>
                <button type="button" className="profile-action-btn profile-action-btn-muted" onClick={() => setAvatarDataUrl(null)}>
                  Убрать фото
                </button>
              </div>
            </div>

            <div className="profile-editor">
              <label className="profile-label" htmlFor="profile-nickname">
                Ник
              </label>
              <input
                id="profile-nickname"
                className="profile-input"
                type="text"
                value={nickname}
                onChange={(event) => {
                  setNickname(event.target.value);
                  setError('');
                }}
                maxLength={32}
                placeholder="Введите ник"
                spellCheck={false}
              />

              <div className="profile-id-box">
                <span className="profile-id-label">Profile ID</span>
                <code className="profile-id-value">{profile.profileId}</code>
              </div>

              <p className="profile-hint">Если фото не загружено, будет использоваться нейтральная аватарка профиля.</p>

              {error && <div className="profile-message profile-message-error">{error}</div>}
              {saveState === 'saved' && <div className="profile-message profile-message-success">Профиль сохранен.</div>}

              <button type="button" className="profile-save-btn" onClick={handleSave} disabled={isSaving}>
                {isSaving ? 'Сохранение...' : 'Сохранить изменения'}
              </button>
            </div>
          </div>

          <input
            ref={avatarInputRef}
            type="file"
            accept="image/*"
            className="profile-avatar-input"
            onChange={handleAvatarUpload}
          />
        </section>
      </div>
    </div>
  );
};
