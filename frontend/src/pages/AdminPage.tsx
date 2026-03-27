import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { getApiUrl } from '../utils/api';
import {
  DEFAULT_PROMPT_NAME,
  PromptConfig,
  SYSTEM_PROMPT,
} from '../utils/gemini';
import {
  clearAdminAuthToken,
  loadAdminAuthToken,
  saveAdminAuthToken,
} from '../utils/storage';
import './AdminPage.css';

interface AdminPageProps {
  onBackHome: () => void;
  secretMode?: boolean;
}

function createDefaultPromptConfig(): PromptConfig {
  return {
    name: DEFAULT_PROMPT_NAME,
    prompt: SYSTEM_PROMPT,
    updatedAt: null,
  };
}

function getAdminHeaders(token: string): HeadersInit {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

export const AdminPage: React.FC<AdminPageProps> = ({ onBackHome, secretMode = false }) => {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [authToken, setAuthToken] = useState<string | null>(() => loadAdminAuthToken());
  const [promptName, setPromptName] = useState(DEFAULT_PROMPT_NAME);
  const [promptText, setPromptText] = useState(SYSTEM_PROMPT);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [isLoadingPrompt, setIsLoadingPrompt] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  const visibleError = secretMode && error
    ? (password.trim() ? 'command rejected.' : 'input required.')
    : error;
  const visibleSuccessMessage = secretMode && successMessage
    ? 'session accepted.'
    : successMessage;

  const formattedUpdatedAt = useMemo(() => {
    if (!updatedAt) {
      return 'Еще не сохранялось';
    }

    const date = new Date(updatedAt);
    if (Number.isNaN(date.getTime())) {
      return updatedAt;
    }

    return new Intl.DateTimeFormat('ru-RU', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date);
  }, [updatedAt]);

  const applyPromptConfig = useCallback((config?: Partial<PromptConfig>) => {
    const merged = {
      ...createDefaultPromptConfig(),
      ...config,
    };

    setPromptName(
      typeof merged.name === 'string' && merged.name.trim()
        ? merged.name
        : DEFAULT_PROMPT_NAME,
    );
    setPromptText(
      typeof merged.prompt === 'string' && merged.prompt.trim()
        ? merged.prompt
        : SYSTEM_PROMPT,
    );
    setUpdatedAt(merged.updatedAt ?? null);
  }, []);

  const handleUnauthorized = useCallback(() => {
    clearAdminAuthToken();
    setAuthToken(null);
    setPassword('');
    setError('Сессия администратора закончилась. Войдите заново.');
    setSuccessMessage('');
    applyPromptConfig();
  }, [applyPromptConfig]);

  const loadAdminPrompt = useCallback(async (token: string) => {
    setIsLoadingPrompt(true);
    setError('');

    try {
      const response = await fetch(getApiUrl('/api/admin/prompt'), {
        headers: getAdminHeaders(token),
      });

      if (response.status === 401) {
        handleUnauthorized();
        return;
      }

      if (!response.ok) {
        throw new Error('Не удалось загрузить текущий промпт.');
      }

      const data = await response.json();
      applyPromptConfig(data);
    } catch (err: any) {
      setError(err.message || 'Не удалось загрузить текущий промпт.');
    } finally {
      setIsLoadingPrompt(false);
      setIsCheckingSession(false);
    }
  }, [applyPromptConfig, handleUnauthorized]);

  useEffect(() => {
    const token = loadAdminAuthToken();
    if (!token) {
      setIsCheckingSession(false);
      return;
    }

    setAuthToken(token);
    loadAdminPrompt(token);
  }, [loadAdminPrompt]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMessage('');

    if ((!secretMode && !username.trim()) || !password.trim()) {
      setError(secretMode ? 'Введите пароль доступа.' : 'Введите логин и пароль администратора.');
      return;
    }

    setIsLoggingIn(true);
    try {
      const response = await fetch(getApiUrl('/api/admin/login'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username: secretMode ? 'admin' : username.trim(),
          password: password.trim(),
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.token) {
        throw new Error(secretMode ? 'Доступ отклонен.' : 'Неверный логин или пароль.');
      }

      saveAdminAuthToken(data.token);
      setAuthToken(data.token);
      setPassword('');
      setSuccessMessage(secretMode ? 'Root shell unlocked.' : 'Вход выполнен.');
      await loadAdminPrompt(data.token);
    } catch (err: any) {
      setError(err.message || 'Не удалось войти в админ-панель.');
      setIsCheckingSession(false);
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authToken) {
      setError('Сначала войдите в админ-панель.');
      return;
    }

    setError('');
    setSuccessMessage('');

    if (!promptName.trim()) {
      setError('Введите название промпта.');
      return;
    }

    if (!promptText.trim()) {
      setError('Введите текст промпта.');
      return;
    }

    setIsSaving(true);
    try {
      const response = await fetch(getApiUrl('/api/admin/prompt'), {
        method: 'PUT',
        headers: getAdminHeaders(authToken),
        body: JSON.stringify({
          name: promptName.trim(),
          prompt: promptText,
        }),
      });

      if (response.status === 401) {
        handleUnauthorized();
        return;
      }

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || 'Не удалось сохранить промпт.');
      }

      applyPromptConfig(data);
      setSuccessMessage('Промпт обновлен.');
    } catch (err: any) {
      setError(err.message || 'Не удалось сохранить промпт.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleResetToDefault = () => {
    applyPromptConfig();
    setError('');
    setSuccessMessage('В редактор подставлен базовый промпт. Сохраните его, если хотите применить.');
  };

  const handleLogout = async () => {
    const token = authToken;
    clearAdminAuthToken();
    setAuthToken(null);
    setPassword('');
    setSuccessMessage('');
    applyPromptConfig();

    if (!token) {
      return;
    }

    try {
      await fetch(getApiUrl('/api/admin/logout'), {
        method: 'POST',
        headers: getAdminHeaders(token),
      });
    } catch {
      // Best effort logout.
    }
  };

  return (
    <div className={`admin-page ${secretMode ? 'admin-page-secret' : ''}`}>
      <div className="admin-orb admin-orb-1" />
      <div className="admin-orb admin-orb-2" />

      <div className="admin-shell">
        <div className="admin-topbar">
          <button type="button" className="admin-ghost-button" onClick={onBackHome}>
            На главную
          </button>
          {authToken && (
            <button type="button" className="admin-ghost-button" onClick={handleLogout}>
              Выйти из админки
            </button>
          )}
        </div>

        <div className="admin-card">
          <div className="admin-card-header">
            <div>
              <span className="admin-kicker">{secretMode ? 'Secure Shell' : 'Limitless Admin'}</span>
              <h1 className="admin-title">
                {secretMode ? 'Скрытый вход администратора' : 'Управление системным промптом'}
              </h1>
              <p className="admin-subtitle">
                {secretMode
                  ? 'Это замаскированный вход через псевдо-консоль. После авторизации откроется обычная админ-панель.'
                  : 'Здесь можно обновить название режима и сам текст промпта. Новые сообщения в чате возьмут актуальную версию с сервера.'}
              </p>
            </div>
            <div className="admin-meta-card">
              <span className="admin-meta-label">Последнее обновление</span>
              <strong>{formattedUpdatedAt}</strong>
            </div>
          </div>

          {visibleError && <div className="admin-banner admin-banner-error">{visibleError}</div>}
          {visibleSuccessMessage && <div className="admin-banner admin-banner-success">{visibleSuccessMessage}</div>}

          {isCheckingSession ? (
            <div className="admin-loading">Проверяю доступ администратора...</div>
          ) : !authToken ? (
            secretMode ? (
              <form className="admin-console-form" onSubmit={handleLogin}>
                <div className="admin-console-window">
                  <div className="admin-console-toolbar">
                    <span className="admin-console-dot admin-console-dot-red" />
                    <span className="admin-console-dot admin-console-dot-yellow" />
                    <span className="admin-console-dot admin-console-dot-green" />
                    <span className="admin-console-title">root@limitless: ~/secure-shell</span>
                  </div>

                  <div className="admin-console-body">
                    <p className="admin-console-line">Last sync: runtime ready</p>
                    <p className="admin-console-line">limitless@node:~$ connect --session</p>
                    <label className="admin-console-prompt" htmlFor="terminal-password">
                      <span className="admin-console-prefix">limitless@node:~/runtime$</span>
                      <input
                        id="terminal-password"
                        className="admin-console-input"
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        autoComplete="off"
                        placeholder="type command..."
                        aria-label="Console input"
                        spellCheck={false}
                        autoFocus
                      />
                    </label>
                    <div className="admin-console-status" aria-live="polite">
                      {isLoggingIn ? 'processing...' : ''}
                    </div>
                  </div>
                </div>
              </form>
            ) : (
              <form className="admin-login-form" onSubmit={handleLogin}>
                <div className="admin-field">
                  <label htmlFor="admin-username">Логин</label>
                  <input
                    id="admin-username"
                    className="admin-input"
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    autoComplete="username"
                    spellCheck={false}
                  />
                </div>

                <div className="admin-field">
                  <label htmlFor="admin-password">Пароль</label>
                  <input
                    id="admin-password"
                    className="admin-input"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                  />
                </div>

                <button type="submit" className="admin-primary-button" disabled={isLoggingIn}>
                  {isLoggingIn ? 'Вход...' : 'Войти в админку'}
                </button>
              </form>
            )
          ) : (
            <form className="admin-editor-form" onSubmit={handleSave}>
              <div className="admin-field">
                <label htmlFor="prompt-name">Название промпта</label>
                <input
                  id="prompt-name"
                  className="admin-input"
                  type="text"
                  value={promptName}
                  onChange={(e) => setPromptName(e.target.value)}
                  placeholder="Например: Limitless X"
                  spellCheck={false}
                />
              </div>

              <div className="admin-field admin-field-large">
                <div className="admin-field-head">
                  <label htmlFor="prompt-text">Текст промпта</label>
                  <button
                    type="button"
                    className="admin-inline-button"
                    onClick={handleResetToDefault}
                  >
                    Подставить базовый
                  </button>
                </div>
                <textarea
                  id="prompt-text"
                  className="admin-textarea"
                  value={promptText}
                  onChange={(e) => setPromptText(e.target.value)}
                  placeholder="Введите новый системный промпт"
                  spellCheck={false}
                />
              </div>

              <div className="admin-actions">
                <button
                  type="button"
                  className="admin-secondary-button"
                  onClick={() => loadAdminPrompt(authToken)}
                  disabled={isLoadingPrompt || isSaving}
                >
                  {isLoadingPrompt ? 'Обновляю...' : 'Загрузить с сервера'}
                </button>
                <button type="submit" className="admin-primary-button" disabled={isSaving || isLoadingPrompt}>
                  {isSaving ? 'Сохраняю...' : 'Сохранить промпт'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
