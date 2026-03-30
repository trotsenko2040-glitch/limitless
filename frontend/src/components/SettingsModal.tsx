import React, { useEffect, useRef, useState } from 'react';
import { AccountProfile } from '../types';
import { saveRemoteAccountSnapshot } from '../utils/accountApi';
import {
  DEFAULT_AI_PROVIDER_ID,
  fetchAvailableModels,
  getDefaultModelId,
  getFallbackModels,
  getProviderConfig,
  getProviderOptions,
  type AIProviderId,
  type AIModelOption,
} from '../utils/aiProvider';
import { DEFAULT_PROMPT_NAME, fetchPromptConfig } from '../utils/gemini';
import { normalizeAccountProfile } from '../utils/profile';
import {
  loadAccountSnapshot,
  loadAuthToken,
  loadOrCreateDeviceId,
  loadSettings,
  saveAccountSnapshot,
  saveSettings,
} from '../utils/storage';
import { ProfileAvatar } from './ProfileAvatar';
import './SettingsModal.css';

interface SettingsModalProps {
  onClose: () => void;
  profile: AccountProfile;
  onProfileSaved?: (profile: AccountProfile) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ onClose, profile, onProfileSaved }) => {
  const [providerId, setProviderId] = useState<AIProviderId>(DEFAULT_AI_PROVIDER_ID);
  const [apiKey, setApiKey] = useState('');
  const [providerApiKeys, setProviderApiKeys] = useState<Partial<Record<AIProviderId, string>>>({});
  const [selectedModelId, setSelectedModelId] = useState(getDefaultModelId(DEFAULT_AI_PROVIDER_ID));
  const [providerModelIds, setProviderModelIds] = useState<Partial<Record<AIProviderId, string>>>({});
  const [autoFallbackEnabled, setAutoFallbackEnabled] = useState(true);
  const [promptName, setPromptName] = useState(DEFAULT_PROMPT_NAME);
  const [nickname, setNickname] = useState(profile.nickname);
  const [profileId, setProfileId] = useState(profile.profileId);
  const [avatarDataUrl, setAvatarDataUrl] = useState<string | null>(profile.avatarDataUrl);
  const [avatarHue, setAvatarHue] = useState(profile.avatarHue);
  const [saved, setSaved] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [models, setModels] = useState<AIModelOption[]>(() => getFallbackModels());
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState('');
  const authToken = loadAuthToken();
  const avatarInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const settings = loadSettings(authToken);
    const nextProviderId = settings.providerId || DEFAULT_AI_PROVIDER_ID;
    const nextProviderApiKeys = settings.providerApiKeys || {};
    const nextProviderModelIds = settings.providerModelIds || {};

    setProviderId(nextProviderId);
    setProviderApiKeys(nextProviderApiKeys);
    setProviderModelIds(nextProviderModelIds);
    setAutoFallbackEnabled(settings.autoFallbackEnabled !== false);
    setApiKey(nextProviderApiKeys[nextProviderId] || settings.apiKey || '');
    setSelectedModelId(nextProviderModelIds[nextProviderId] || settings.selectedModelId || getDefaultModelId(nextProviderId));
    setNickname(profile.nickname);
    setProfileId(profile.profileId);
    setAvatarDataUrl(profile.avatarDataUrl);
    setAvatarHue(profile.avatarHue);

    let isMounted = true;
    fetchPromptConfig().then((config) => {
      if (isMounted) {
        setPromptName(config.name);
      }
    });

    return () => {
      isMounted = false;
    };
  }, [authToken, profile]);

  useEffect(() => {
    let isMounted = true;
    const controller = new AbortController();
    const trimmedApiKey = apiKey.trim();

    if (!trimmedApiKey) {
      const fallbackModels = getFallbackModels(providerId);
      setModels(fallbackModels);
      if (!fallbackModels.some((model) => model.id === selectedModelId)) {
        const nextModelId = fallbackModels[0]?.id || getDefaultModelId(providerId);
        setSelectedModelId(nextModelId);
        setProviderModelIds((current) => ({ ...current, [providerId]: nextModelId }));
      }
      setModelsError('');
      return () => controller.abort();
    }

    setModelsLoading(true);
    setModelsError('');

    fetchAvailableModels(providerId, trimmedApiKey, controller.signal)
      .then((nextModels) => {
        if (!isMounted) {
          return;
        }

        setModels(nextModels);
        if (!nextModels.some((model) => model.id === selectedModelId)) {
          const nextModelId = nextModels[0]?.id || getDefaultModelId(providerId);
          setSelectedModelId(nextModelId);
          setProviderModelIds((current) => ({ ...current, [providerId]: nextModelId }));
        }
      })
      .catch((error: Error) => {
        if (!isMounted) {
          return;
        }

        setModels(getFallbackModels(providerId));
        setModelsError(error.message);
      })
      .finally(() => {
        if (isMounted) {
          setModelsLoading(false);
        }
      });

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [apiKey, providerId, selectedModelId]);

  const handleAvatarUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    if (!file.type.startsWith('image/')) {
      setSaveError('Можно загрузить только изображение для аватарки.');
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      setSaveError('Аватар слишком большой. Используйте файл до 2 МБ.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setAvatarDataUrl(reader.result);
        setSaveError('');
      }
    };
    reader.onerror = () => {
      setSaveError('Не удалось прочитать файл аватара.');
    };
    reader.readAsDataURL(file);
  };

  const handleRefreshModels = async () => {
    const trimmedApiKey = apiKey.trim();
    if (!trimmedApiKey) {
      const fallbackModels = getFallbackModels(providerId);
      setModels(fallbackModels);
      if (!fallbackModels.some((model) => model.id === selectedModelId)) {
        const nextModelId = fallbackModels[0]?.id || getDefaultModelId(providerId);
        setSelectedModelId(nextModelId);
        setProviderModelIds((current) => ({ ...current, [providerId]: nextModelId }));
      }
      setModelsError('Сначала добавьте API ключ.');
      return;
    }

    setModelsLoading(true);
    setModelsError('');

    try {
      const nextModels = await fetchAvailableModels(providerId, trimmedApiKey);
      setModels(nextModels);
      if (!nextModels.some((model) => model.id === selectedModelId)) {
        const nextModelId = nextModels[0]?.id || getDefaultModelId(providerId);
        setSelectedModelId(nextModelId);
        setProviderModelIds((current) => ({ ...current, [providerId]: nextModelId }));
      }
    } catch (error: any) {
      setModelsError(error?.message || 'Не удалось обновить список моделей.');
    } finally {
      setModelsLoading(false);
    }
  };

  const handleSave = async () => {
    setSaveError('');

    const nextSettings = {
      providerId,
      apiKey: apiKey.trim(),
      providerApiKeys: {
        ...providerApiKeys,
        [providerId]: apiKey.trim(),
      },
      selectedModelId: selectedModelId.trim() || getDefaultModelId(providerId),
      providerModelIds: {
        ...providerModelIds,
        [providerId]: selectedModelId.trim() || getDefaultModelId(providerId),
      },
      autoFallbackEnabled,
      theme: 'dark' as const,
    };
    const nextProfile = normalizeAccountProfile(
      {
        profileId,
        nickname,
        avatarDataUrl,
        avatarHue,
      },
      authToken,
    );

    saveSettings(nextSettings, authToken);
    onProfileSaved?.(nextProfile);

    if (authToken) {
      const nextSnapshot = {
        ...loadAccountSnapshot(authToken),
        settings: nextSettings,
        profile: nextProfile,
      };

      saveAccountSnapshot(nextSnapshot, authToken);

      try {
        await saveRemoteAccountSnapshot(authToken, loadOrCreateDeviceId(), nextSnapshot);
      } catch {
        setSaveError('Не удалось сохранить настройки на сервере. Локально они уже сохранены.');
      }
    }

    setSaved(true);
    window.setTimeout(() => {
      setSaved(false);
      onClose();
    }, 1200);
  };

  const handleOverlayClick = (event: React.MouseEvent) => {
    if (event.target === event.currentTarget) {
      onClose();
    }
  };

  const selectedModel = models.find((model) => model.id === selectedModelId);
  const providerConfig = getProviderConfig(providerId);
  const providerOptions = getProviderOptions();

  return (
    <div className="settings-overlay" onClick={handleOverlayClick}>
      <div className="settings-modal animate-scale-in">
        <div className="settings-header">
          <h2 className="settings-title">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            Настройки
          </h2>
          <button className="settings-close" onClick={onClose}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="settings-body">
          {saveError && <div className="settings-hint">{saveError}</div>}

          <div className="settings-section">
            <label className="settings-label">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M20 21a8 8 0 1 0-16 0" />
                <circle cx="12" cy="7" r="4" />
              </svg>
              Профиль
            </label>

            <div className="settings-profile-card">
              <ProfileAvatar
                className="settings-profile-avatar"
                nickname={nickname}
                avatarDataUrl={avatarDataUrl}
                avatarHue={avatarHue}
                fallback="silhouette"
              />
              <div className="settings-profile-meta">
                <div className="settings-profile-id">{profileId}</div>
                <div className="settings-profile-actions">
                  <button
                    type="button"
                    className="settings-avatar-button"
                    onClick={() => avatarInputRef.current?.click()}
                  >
                    Загрузить аву
                  </button>
                  <button
                    type="button"
                    className="settings-avatar-button settings-avatar-button-muted"
                    onClick={() => setAvatarDataUrl(null)}
                  >
                    Сбросить
                  </button>
                </div>
              </div>
            </div>

            <input
              ref={avatarInputRef}
              type="file"
              accept="image/*"
              className="settings-avatar-input"
              onChange={handleAvatarUpload}
            />

            <div className="settings-input-group">
              <input
                type="text"
                className="settings-input"
                placeholder="Введите ник"
                value={nickname}
                onChange={(event) => setNickname(event.target.value)}
                spellCheck={false}
                maxLength={32}
              />
            </div>

            <div className="settings-profile-id-row">
              <span className="settings-profile-id-label">Profile ID</span>
              <code className="settings-profile-id-code">{profileId}</code>
            </div>

            <p className="settings-hint">
              У каждого профиля свой постоянный ID. Ник и аватар можно менять в любой момент.
            </p>
          </div>

          <div className="settings-section">
            <label className="settings-label">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
              </svg>
              Провайдер
            </label>
            <div className="settings-model-row">
              <div className="settings-select-group">
                <select
                  className="settings-select"
                  value={providerId}
                  onChange={(event) => {
                    const nextProviderId = event.target.value as AIProviderId;
                    setProviderId(nextProviderId);
                    setApiKey(providerApiKeys[nextProviderId] || '');
                    setSelectedModelId(providerModelIds[nextProviderId] || getDefaultModelId(nextProviderId));
                    setModels(getFallbackModels(nextProviderId));
                    setModelsError('');
                  }}
                >
                  {providerOptions.map((provider) => (
                    <option key={provider.id} value={provider.id}>
                      {provider.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <p className="settings-hint">{providerConfig.description}</p>
            <label className="settings-toggle">
              <input
                type="checkbox"
                checked={autoFallbackEnabled}
                onChange={(event) => setAutoFallbackEnabled(event.target.checked)}
              />
              <span>Автопереключение на запасной провайдер при лимите или перегрузе</span>
            </label>
          </div>

          <div className="settings-section">
            <label className="settings-label">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
              </svg>
              API ключ
            </label>
            <p className="settings-hint">
              Подключение идет через{' '}
              <a href={providerConfig.docsUrl} target="_blank" rel="noopener noreferrer">
                {providerConfig.label}
              </a>
              .
            </p>
            <div className="settings-input-group">
              <input
                type="text"
                className={`settings-input${showKey ? '' : ' settings-input-masked'}`}
                placeholder="Bearer key..."
                value={apiKey}
                onChange={(event) => {
                  const nextApiKey = event.target.value;
                  setApiKey(nextApiKey);
                  setProviderApiKeys((current) => ({ ...current, [providerId]: nextApiKey }));
                }}
                spellCheck={false}
                autoComplete="off"
              />
              <button
                className="toggle-visibility"
                onClick={() => setShowKey((current) => !current)}
                type="button"
                title={showKey ? 'Скрыть' : 'Показать'}
              >
                {showKey ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          <div className="settings-section">
            <label className="settings-label">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M12 2L2 7l10 5 10-5-10-5z" />
                <path d="M2 17l10 5 10-5" />
                <path d="M2 12l10 5 10-5" />
              </svg>
              Версия
            </label>
            <div className="settings-model-row">
              <div className="settings-select-group">
                <select
                  className="settings-select"
                  value={selectedModelId}
                  onChange={(event) => {
                    const nextModelId = event.target.value;
                    setSelectedModelId(nextModelId);
                    setProviderModelIds((current) => ({ ...current, [providerId]: nextModelId }));
                  }}
                  disabled={modelsLoading}
                >
                  {models.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.label}
                    </option>
                  ))}
                </select>
              </div>
              <button type="button" className="settings-avatar-button settings-model-refresh" onClick={handleRefreshModels}>
                {modelsLoading ? 'Загрузка...' : 'Обновить'}
              </button>
            </div>
            {selectedModel && (
              <div className="model-info">
                <span className="model-badge">{selectedModel.label}</span>
                <span className="model-desc">{selectedModel.description}</span>
              </div>
            )}
            {modelsError && <p className="settings-hint settings-hint-error">{modelsError}</p>}
          </div>

          <div className="settings-section">
            <label className="settings-label">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
              Системный промпт
            </label>
            <div className="system-prompt-info">
              <span className="prompt-badge">{promptName}</span>
              <span className="prompt-desc">Промпт берется из админки и подставляется в каждый новый ответ.</span>
            </div>
          </div>
        </div>

        <div className="settings-footer">
          <button className="settings-cancel" onClick={onClose}>
            Отмена
          </button>
          <button className={`settings-save ${saved ? 'saved' : ''}`} onClick={handleSave}>
            {saved ? (
              <>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                Сохранено
              </>
            ) : (
              'Сохранить'
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
