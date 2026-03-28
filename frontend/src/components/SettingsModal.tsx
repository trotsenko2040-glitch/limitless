import React, { useEffect, useState } from 'react';
import { saveRemoteAccountSnapshot } from '../utils/accountApi';
import {
  DEFAULT_PROMPT_NAME,
  fetchPromptConfig,
  GEMINI_MODEL_DESCRIPTION,
  GEMINI_MODEL_LABEL,
} from '../utils/gemini';
import {
  loadAccountSnapshot,
  loadAuthToken,
  loadOrCreateDeviceId,
  loadSettings,
  saveAccountSnapshot,
  saveSettings,
} from '../utils/storage';
import './SettingsModal.css';

interface SettingsModalProps {
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ onClose }) => {
  const [apiKey, setApiKey] = useState('');
  const [promptName, setPromptName] = useState(DEFAULT_PROMPT_NAME);
  const [saved, setSaved] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [saveError, setSaveError] = useState('');
  const authToken = loadAuthToken();

  useEffect(() => {
    const settings = loadSettings(authToken);
    setApiKey(settings.geminiApiKey || '');

    let isMounted = true;
    fetchPromptConfig().then((config) => {
      if (isMounted) {
        setPromptName(config.name);
      }
    });

    return () => {
      isMounted = false;
    };
  }, []);

  const handleSave = async () => {
    setSaveError('');

    const nextSettings = { geminiApiKey: apiKey.trim(), theme: 'dark' as const };
    saveSettings(nextSettings, authToken);

    if (authToken) {
      const nextSnapshot = {
        ...loadAccountSnapshot(authToken),
        settings: nextSettings,
      };
      saveAccountSnapshot(nextSnapshot, authToken);

      try {
        await saveRemoteAccountSnapshot(authToken, loadOrCreateDeviceId(), nextSnapshot);
      } catch {
        setSaveError('Не удалось сохранить настройки на сервере. Локально они сохранены.');
        return;
      }
    }

    setSaved(true);
    setTimeout(() => {
      setSaved(false);
      onClose();
    }, 1200);
  };

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

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
                <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
              </svg>
              API ключ Gemini
            </label>
            <p className="settings-hint">
              Получите ключ на{' '}
              <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer">
                Google AI Studio
              </a>
            </p>
            <div className="settings-input-group">
              <input
                type={showKey ? 'text' : 'password'}
                className="settings-input"
                placeholder="AIzaSy..."
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                spellCheck={false}
              />
              <button
                className="toggle-visibility"
                onClick={() => setShowKey(!showKey)}
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
              Модель
            </label>
            <div className="model-info">
              <span className="model-badge">{GEMINI_MODEL_LABEL}</span>
              <span className="model-desc">{GEMINI_MODEL_DESCRIPTION}</span>
            </div>
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
              <span className="prompt-desc">Кастомный prompt-режим активен</span>
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
