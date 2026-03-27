import React, { useState } from 'react';
import { resolveAuthError } from '../utils/authErrors';
import { fetchApi } from '../utils/api';
import { loadOrCreateDeviceId } from '../utils/storage';
import './AuthPage.css';

interface AuthPageProps {
  onAuth: (token: string) => void;
  locked?: boolean;
  lockedMessage?: string;
  onRetryLockedToken?: () => void;
  onBack?: () => void;
}

export const AuthPage: React.FC<AuthPageProps> = ({
  onAuth,
  locked = false,
  lockedMessage,
  onRetryLockedToken,
  onBack,
}) => {
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isFocused, setIsFocused] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (locked) {
      onRetryLockedToken?.();
      return;
    }

    setError('');

    if (!token.trim()) {
      setError('Введите токен');
      return;
    }

    if (token.trim().length < 5) {
      setError('Слишком короткий токен');
      return;
    }

    setIsLoading(true);

    try {
      const deviceId = loadOrCreateDeviceId();
      const response = await fetchApi('/api/validate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ token: token.trim(), deviceId }),
      });

      if (!response.ok) {
        throw new Error('Ошибка сервера валидации');
      }

      const data = await response.json();
      if (!data.valid) {
        throw new Error(resolveAuthError(data.error));
      }

      onAuth(data.token || token.trim());
    } catch (err: any) {
      if (
        err?.name === 'AbortError' ||
        err?.message?.includes('Failed to fetch') ||
        err?.message?.includes('NetworkError')
      ) {
        setError(resolveAuthError('VALIDATION_UNAVAILABLE'));
      } else {
        setError(err.message || resolveAuthError());
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="bg-orb bg-orb-1" />
      <div className="bg-orb bg-orb-2" />
      <div className="bg-orb bg-orb-3" />

      <div className="auth-card">
        {!locked && onBack && (
          <button type="button" className="auth-back" onClick={onBack}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="19" y1="12" x2="5" y2="12" />
              <polyline points="12 19 5 12 12 5" />
            </svg>
            Назад
          </button>
        )}

        <div className="auth-logo">
          <div className="auth-logo-icon">
            <img className="auth-logo-mark" src="/limitless-icon.svg" alt="Limitless icon" />
          </div>
          <img className="auth-logo-wordmark" src="/limitless-logo.svg" alt="Limitless" />
          <p className="auth-subtitle">Custom Prompt Access</p>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          {!locked && (
            <div className={`auth-input-wrapper ${isFocused ? 'focused' : ''} ${error ? 'error' : ''}`}>
              <div className="auth-input-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
              </div>
              <input
                type="text"
                className="auth-input"
                placeholder="Вставьте токен или ключ из Telegram-бота"
                value={token}
                onChange={(e) => {
                  setToken(e.target.value);
                  setError('');
                }}
                onFocus={() => setIsFocused(true)}
                onBlur={() => setIsFocused(false)}
                autoComplete="off"
                spellCheck={false}
              />
            </div>
          )}

          {locked && (
            <div className="auth-info animate-fade-in-up">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 16v-4" />
                <path d="M12 8h.01" />
              </svg>
              {lockedMessage || 'Это устройство уже активировано. Вход с другим токеном отключен.'}
            </div>
          )}

          {error && !locked && (
            <div className="auth-error animate-fade-in-up">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              {error}
            </div>
          )}

          <button
            type={locked ? 'button' : 'submit'}
            className={`auth-button ${isLoading ? 'loading' : ''}`}
            disabled={isLoading}
            onClick={locked ? onRetryLockedToken : undefined}
          >
            {isLoading ? (
              <div className="auth-spinner" />
            ) : (
              <>
                <span>{locked ? 'Повторить проверку' : 'Войти'}</span>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="5" y1="12" x2="19" y2="12" />
                  <polyline points="12 5 19 12 12 19" />
                </svg>
              </>
            )}
          </button>
        </form>

        <div className="auth-footer">
          <p>
            Получите токен в{' '}
            <a href="https://t.me/LimitlesspromtShop_bot" target="_blank" rel="noopener noreferrer">
              Telegram-боте
            </a>
          </p>
        </div>

        <div className="auth-particles">
          {Array.from({ length: 20 }).map((_, i) => (
            <div
              key={i}
              className="particle"
              style={
                {
                  '--delay': `${Math.random() * 5}s`,
                  '--duration': `${3 + Math.random() * 4}s`,
                  '--x': `${Math.random() * 100}%`,
                  '--y': `${Math.random() * 100}%`,
                  '--size': `${2 + Math.random() * 3}px`,
                } as React.CSSProperties
              }
            />
          ))}
        </div>
      </div>
    </div>
  );
};
