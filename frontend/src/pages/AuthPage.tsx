import React, { useState } from 'react';
import './AuthPage.css';

interface AuthPageProps {
  onAuth: (token: string) => void;
}

export const AuthPage: React.FC<AuthPageProps> = ({ onAuth }) => {
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isFocused, setIsFocused] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
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
      const response = await fetch('/api/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token.trim() })
      });

      if (!response.ok) {
        throw new Error('Ошибка связи с сервером');
      }

      const data = await response.json();
      if (!data.valid) {
        throw new Error('Недействительный или отозванный токен');
      }

      onAuth(token.trim());
    } catch (err: any) {
      if (err.message.includes('Failed to fetch') || err.message.includes('NetworkError')) {
        setError('Бэкенд-сервер отключен (rust-backend не запущен)');
      } else {
        setError(err.message || 'Ошибка проверки токена');
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
        <div className="auth-logo">
          <div className="auth-logo-icon">
            <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
              <path d="M20 4L36 12V28L20 36L4 28V12L20 4Z" stroke="url(#logo-grad)" strokeWidth="2" fill="none" />
              <path d="M20 10L30 16V26L20 32L10 26V16L20 10Z" fill="url(#logo-grad)" opacity="0.3" />
              <path d="M20 16L25 19V25L20 28L15 25V19L20 16Z" fill="url(#logo-grad)" />
              <defs>
                <linearGradient id="logo-grad" x1="4" y1="4" x2="36" y2="36">
                  <stop stopColor="#a78bfa" />
                  <stop offset="1" stopColor="#6d28d9" />
                </linearGradient>
              </defs>
            </svg>
          </div>
          <h1 className="auth-title">LIMITLESS</h1>
          <p className="auth-subtitle">Neural Network Interface</p>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
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
              placeholder="Вставьте токен из Telegram бота"
              value={token}
              onChange={(e) => { setToken(e.target.value); setError(''); }}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          {error && (
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
            type="submit"
            className={`auth-button ${isLoading ? 'loading' : ''}`}
            disabled={isLoading}
          >
            {isLoading ? (
              <div className="auth-spinner" />
            ) : (
              <>
                <span>Войти</span>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="5" y1="12" x2="19" y2="12" />
                  <polyline points="12 5 19 12 12 19" />
                </svg>
              </>
            )}
          </button>
        </form>

        <div className="auth-footer">
          <p>Получите токен в <a href="https://t.me/LimitlesspromtShop_bot" target="_blank" rel="noopener noreferrer">Telegram боте</a></p>
        </div>

        <div className="auth-particles">
          {Array.from({ length: 20 }).map((_, i) => (
            <div key={i} className="particle" style={{
              '--delay': `${Math.random() * 5}s`,
              '--duration': `${3 + Math.random() * 4}s`,
              '--x': `${Math.random() * 100}%`,
              '--y': `${Math.random() * 100}%`,
              '--size': `${2 + Math.random() * 3}px`,
            } as React.CSSProperties} />
          ))}
        </div>
      </div>
    </div>
  );
};
