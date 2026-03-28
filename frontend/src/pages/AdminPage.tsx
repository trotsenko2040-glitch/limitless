import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ProfileAvatar } from '../components/ProfileAvatar';
import { getApiUrl } from '../utils/api';
import { DEFAULT_PROMPT_NAME, PromptConfig, SYSTEM_PROMPT } from '../utils/gemini';
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

interface AdminUsersSummary {
  totalUsers: number;
  activeUsers: number;
  bannedUsers: number;
  boundDevices: number;
}

interface AdminUserRecord {
  token: string;
  chatId: number;
  username: string;
  profileId?: string | null;
  profileNickname?: string | null;
  profileAvatarDataUrl?: string | null;
  profileAvatarHue?: number | null;
  profileCreatedAt?: string | null;
  createdAt?: string | null;
  activatedDeviceId?: string | null;
  activatedAt?: string | null;
  subscriptionPlan?: string | null;
  subscriptionStatus?: string | null;
  subscriptionExpiresAt?: string | null;
  revokedAt?: string | null;
  lastSeenAt?: string | null;
  isBanned: boolean;
  isBound: boolean;
}

interface AdminUsersResponse {
  success: boolean;
  users?: AdminUserRecord[];
  summary?: AdminUsersSummary | null;
  error?: string;
}

interface AdminUserActionResponse {
  success: boolean;
  user?: AdminUserRecord | null;
  error?: string;
}

type AdminSection = 'prompt' | 'users';

function createDefaultPromptConfig(): PromptConfig {
  return {
    name: DEFAULT_PROMPT_NAME,
    prompt: SYSTEM_PROMPT,
    updatedAt: null,
  };
}

function createEmptySummary(): AdminUsersSummary {
  return {
    totalUsers: 0,
    activeUsers: 0,
    bannedUsers: 0,
    boundDevices: 0,
  };
}

function getAdminHeaders(token: string): HeadersInit {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

function formatDateTime(value?: string | null): string {
  if (!value) {
    return 'Нет данных';
  }

  const parsedDate = new Date(value);
  if (Number.isNaN(parsedDate.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(parsedDate);
}

function getUserState(user: AdminUserRecord): { label: string; className: string } {
  if (user.isBanned) {
    return { label: 'Забанен', className: 'admin-user-badge-banned' };
  }

  if (user.subscriptionStatus === 'active') {
    return { label: 'Активен', className: 'admin-user-badge-active' };
  }

  return { label: 'Неактивен', className: 'admin-user-badge-inactive' };
}

function getPlanLabel(user: AdminUserRecord): string {
  switch (user.subscriptionPlan) {
    case 'lifetime':
      return 'Навсегда';
    case 'subscription_90d':
      return '90 дней';
    case 'subscription_30d':
      return '30 дней';
    case 'manual_extend':
      return 'Продлен вручную';
    case 'inactive':
    case undefined:
    case null:
      return 'Нет доступа';
    default:
      return user.subscriptionPlan;
  }
}

function getDisplayProfileName(user: AdminUserRecord): string {
  return user.profileNickname?.trim() || user.username?.trim() || 'User';
}

function getDisplayTelegramLabel(user: AdminUserRecord): string {
  if (user.username?.trim()) {
    return `@${user.username.trim()}`;
  }

  return `Chat ID ${user.chatId}`;
}

function resolveAdminError(error?: string): string {
  if (error?.startsWith('PROMPT_SAVE_FAILED')) {
    return 'Backend не смог сохранить промпт в хранилище. Сделайте redeploy backend или проверьте путь хранения.';
  }

  if (error?.startsWith('PROMPT_LOAD_FAILED')) {
    return 'Backend не смог прочитать сохраненный промпт. Проверьте storage и сделайте redeploy backend.';
  }

  switch (error) {
    case 'ADMIN_USERS_PARSE_FAILED':
      return 'Сервис пользователей вернул неожиданный ответ. Обычно это значит, что backend и Telegram bot работают на разных версиях.';
    case 'ADMIN_USERS_UNAVAILABLE':
      return 'Сервис пользователей временно недоступен. Проверьте BOT_API_URL и состояние Telegram bot API.';
    case 'ADMIN_USERS_ROUTE_MISSING':
      return 'Telegram bot API запущен на старой версии и еще не знает маршрут /api/admin/users.';
    case 'ADMIN_BRIDGE_UNAUTHORIZED':
      return 'Backend не авторизован в Telegram bot API. Сверьте BOT_INTERNAL_API_KEY в backend и bot service.';
    case 'ADMIN_USER_ACTION_PARSE_FAILED':
      return 'Не удалось разобрать ответ сервиса пользователей. Обновите backend и bot service до одной версии.';
    case 'ADMIN_USER_ACTION_UNAVAILABLE':
      return 'Команда для пользователя не дошла до Telegram bot API. Проверьте BOT_API_URL.';
    case 'TOKEN_NOT_FOUND':
      return 'Пользователь с таким токеном не найден.';
    case 'TOKEN_REQUIRED':
      return 'Для действия не выбран токен пользователя.';
    case 'ADMIN_AUTH_REQUIRED':
    case 'ADMIN_AUTH_INVALID':
      return 'Сессия администратора недействительна. Войдите заново.';
    default:
      return error || 'Произошла ошибка при работе с админ-панелью.';
  }
}

export const AdminPage: React.FC<AdminPageProps> = ({ onBackHome, secretMode = false }) => {
  const promptTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [activeSection, setActiveSection] = useState<AdminSection>('prompt');
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [authToken, setAuthToken] = useState<string | null>(() => loadAdminAuthToken());
  const [promptName, setPromptName] = useState(DEFAULT_PROMPT_NAME);
  const [promptText, setPromptText] = useState(SYSTEM_PROMPT);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [users, setUsers] = useState<AdminUserRecord[]>([]);
  const [summary, setSummary] = useState<AdminUsersSummary>(createEmptySummary());
  const [userSearch, setUserSearch] = useState('');
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [isLoadingPrompt, setIsLoadingPrompt] = useState(false);
  const [isLoadingUsers, setIsLoadingUsers] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [userActionToken, setUserActionToken] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [promptRenderKey, setPromptRenderKey] = useState(0);

  const visibleError = secretMode && error ? (password.trim() ? 'command rejected.' : 'input required.') : error;
  const visibleSuccessMessage = secretMode && successMessage ? 'session accepted.' : successMessage;

  const formattedUpdatedAt = useMemo(() => {
    if (!updatedAt) {
      return 'Еще не сохранялось';
    }

    return formatDateTime(updatedAt);
  }, [updatedAt]);

  const promptCharacters = useMemo(() => promptText.length, [promptText]);

  const visibleUsers = useMemo(() => {
    const query = userSearch.trim().toLowerCase();
    if (!query) {
      return users;
    }

    return users.filter((user) => {
      const haystack = [
        user.username,
        user.token,
        user.chatId?.toString(),
        user.profileId,
        user.profileNickname,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return haystack.includes(query);
    });
  }, [userSearch, users]);

  const applyPromptConfig = useCallback((config?: Partial<PromptConfig>) => {
    const merged = {
      ...createDefaultPromptConfig(),
      ...config,
    };

    setPromptName(typeof merged.name === 'string' && merged.name.trim() ? merged.name : DEFAULT_PROMPT_NAME);
    setPromptText(typeof merged.prompt === 'string' && merged.prompt.trim() ? merged.prompt : SYSTEM_PROMPT);
    setUpdatedAt(merged.updatedAt ?? null);
    setPromptRenderKey((previous) => previous + 1);
  }, []);

  useEffect(() => {
    if (activeSection !== 'prompt') {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      if (promptTextareaRef.current) {
        promptTextareaRef.current.scrollTop = 0;
      }
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [activeSection, promptRenderKey]);

  const handleUnauthorized = useCallback(() => {
    clearAdminAuthToken();
    setAuthToken(null);
    setPassword('');
    setUsers([]);
    setSummary(createEmptySummary());
    setError('Сессия администратора закончилась. Войдите заново.');
    setSuccessMessage('');
    applyPromptConfig();
  }, [applyPromptConfig]);

  const loadAdminPrompt = useCallback(async (token: string) => {
    setIsLoadingPrompt(true);

    try {
      const response = await fetch(getApiUrl('/api/admin/prompt'), {
        headers: getAdminHeaders(token),
      });

      if (response.status === 401) {
        handleUnauthorized();
        return false;
      }

      if (!response.ok) {
        throw new Error('Не удалось загрузить текущий промпт.');
      }

      const data = await response.json();
      applyPromptConfig(data);
      return true;
    } catch (requestError: any) {
      setError(requestError.message || 'Не удалось загрузить текущий промпт.');
      return false;
    } finally {
      setIsLoadingPrompt(false);
    }
  }, [applyPromptConfig, handleUnauthorized]);

  const loadAdminUsers = useCallback(async (token: string, search = '') => {
    setIsLoadingUsers(true);

    try {
      const params = new URLSearchParams();
      params.set('limit', '250');
      if (search.trim()) {
        params.set('search', search.trim());
      }

      const response = await fetch(getApiUrl(`/api/admin/users?${params.toString()}`), {
        headers: getAdminHeaders(token),
      });

      if (response.status === 401) {
        handleUnauthorized();
        return false;
      }

      const data: AdminUsersResponse = await response.json().catch(() => ({ success: false }));
      if (!response.ok || !data.success) {
        throw new Error(resolveAdminError(data.error));
      }

      setUsers(data.users ?? []);
      setSummary(data.summary ?? createEmptySummary());
      return true;
    } catch (requestError: any) {
      setError(requestError.message || 'Не удалось загрузить пользователей.');
      return false;
    } finally {
      setIsLoadingUsers(false);
    }
  }, [handleUnauthorized]);

  useEffect(() => {
    const token = loadAdminAuthToken();
    if (!token) {
      setIsCheckingSession(false);
      return;
    }

    setAuthToken(token);

    const bootstrap = async () => {
      await Promise.all([
        loadAdminPrompt(token),
        loadAdminUsers(token, ''),
      ]);
      setIsCheckingSession(false);
    };

    bootstrap();
  }, [loadAdminPrompt, loadAdminUsers]);

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault();
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
      setActiveSection('prompt');
      setPassword('');
      setSuccessMessage(secretMode ? 'session accepted.' : 'Вход выполнен.');
      await Promise.all([
        loadAdminPrompt(data.token),
        loadAdminUsers(data.token, ''),
      ]);
    } catch (requestError: any) {
      setError(requestError.message || 'Не удалось войти в админ-панель.');
      setIsCheckingSession(false);
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleSavePrompt = async (event: React.FormEvent) => {
    event.preventDefault();
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
        throw new Error(resolveAdminError(data?.error));
      }

      applyPromptConfig(data);
      setSuccessMessage('Промпт обновлен.');
    } catch (requestError: any) {
      setError(requestError.message || 'Не удалось сохранить промпт.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleResetToDefault = () => {
    applyPromptConfig();
    setError('');
    setSuccessMessage('В редактор подставлен базовый шаблон. Сохраните его, если хотите применить.');
  };

  const handleLogout = async () => {
    const currentToken = authToken;
    clearAdminAuthToken();
    setAuthToken(null);
    setPassword('');
    setUsers([]);
    setSummary(createEmptySummary());
    setSuccessMessage('');
    applyPromptConfig();

    if (!currentToken) {
      return;
    }

    try {
      await fetch(getApiUrl('/api/admin/logout'), {
        method: 'POST',
        headers: getAdminHeaders(currentToken),
      });
    } catch {
      // Best effort logout.
    }
  };

  const handleUsersSearchSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!authToken) {
      return;
    }

    setError('');
    setSuccessMessage('');
    await loadAdminUsers(authToken, userSearch);
  };

  const handleRefreshUsers = async () => {
    if (!authToken) {
      return;
    }

    setError('');
    setSuccessMessage('');
    await loadAdminUsers(authToken, userSearch);
  };

  const handleUserAction = async (user: AdminUserRecord, action: 'ban' | 'unban') => {
    if (!authToken) {
      return;
    }

    setUserActionToken(user.token);
    setError('');
    setSuccessMessage('');

    try {
      const response = await fetch(getApiUrl(`/api/admin/users/${action}`), {
        method: 'POST',
        headers: getAdminHeaders(authToken),
        body: JSON.stringify({ token: user.token }),
      });

      if (response.status === 401) {
        handleUnauthorized();
        return;
      }

      const data: AdminUserActionResponse = await response.json().catch(() => ({ success: false }));
      if (!response.ok || !data.success || !data.user) {
        throw new Error(resolveAdminError(data.error));
      }

      setUsers((previousUsers) => previousUsers.map((item) => (
        item.token === data.user?.token ? data.user : item
      )));
      setSummary((previousSummary) => {
        const delta = action === 'ban' ? 1 : -1;
        return {
          ...previousSummary,
          bannedUsers: Math.max(0, previousSummary.bannedUsers + delta),
        };
      });
      setSuccessMessage(
        action === 'ban'
          ? `Пользователь ${getDisplayProfileName(user)} забанен.`
          : `Пользователь ${getDisplayProfileName(user)} разбанен.`,
      );
    } catch (requestError: any) {
      setError(requestError.message || 'Не удалось обновить пользователя.');
    } finally {
      setUserActionToken(null);
    }
  };

  const renderUsersSection = () => (
    <>
      <section className="admin-section">
        <div className="admin-section-header">
          <div>
            <h2 className="admin-section-title">Пользователи</h2>
            <p className="admin-section-subtitle">Смотрите количество пользователей, их профили и управляйте доступом.</p>
          </div>
        </div>

        <div className="admin-stats-grid">
          <article className="admin-stat-card">
            <span className="admin-stat-label">Всего пользователей</span>
            <strong className="admin-stat-value">{summary.totalUsers}</strong>
          </article>
          <article className="admin-stat-card">
            <span className="admin-stat-label">Активные</span>
            <strong className="admin-stat-value">{summary.activeUsers}</strong>
          </article>
          <article className="admin-stat-card">
            <span className="admin-stat-label">Забаненные</span>
            <strong className="admin-stat-value">{summary.bannedUsers}</strong>
          </article>
          <article className="admin-stat-card">
            <span className="admin-stat-label">Привязанные устройства</span>
            <strong className="admin-stat-value">{summary.boundDevices}</strong>
          </article>
        </div>
      </section>

      <section className="admin-section">
        <div className="admin-section-header">
          <div>
            <h2 className="admin-section-title">Список пользователей</h2>
            <p className="admin-section-subtitle">Ищите по нику, profile id, chat id или токену. Здесь же можно банить и разбанивать доступ.</p>
          </div>
        </div>

        <div className="admin-users-toolbar">
          <form className="admin-search-form" onSubmit={handleUsersSearchSubmit}>
            <input
              className="admin-search-input"
              type="text"
              value={userSearch}
              onChange={(event) => setUserSearch(event.target.value)}
              placeholder="Поиск по нику, profile id, chat id или токену"
              spellCheck={false}
            />
            <button type="submit" className="admin-secondary-button" disabled={isLoadingUsers}>
              {isLoadingUsers ? 'Ищу...' : 'Найти'}
            </button>
          </form>

          <button type="button" className="admin-secondary-button" onClick={handleRefreshUsers} disabled={isLoadingUsers}>
            {isLoadingUsers ? 'Обновляю...' : 'Обновить список'}
          </button>
        </div>

        {visibleUsers.length === 0 ? (
          <div className="admin-empty-state">
            {isLoadingUsers ? 'Загружаю пользователей...' : 'Пользователи не найдены.'}
          </div>
        ) : (
          <div className="admin-user-list">
            {visibleUsers.map((user) => {
              const userState = getUserState(user);
              const isActionRunning = userActionToken === user.token;

              return (
                <article key={user.token} className="admin-user-card">
                  <div className="admin-user-head">
                    <div className="admin-user-identity">
                      <ProfileAvatar
                        className="admin-user-avatar"
                        nickname={getDisplayProfileName(user)}
                        avatarDataUrl={user.profileAvatarDataUrl}
                        avatarHue={user.profileAvatarHue}
                      />
                      <div className="admin-user-title-group">
                        <h3 className="admin-user-name">{getDisplayProfileName(user)}</h3>
                        <div className="admin-user-subtitle-row">
                          <span className="admin-user-subtitle">{getDisplayTelegramLabel(user)}</span>
                          <code className="admin-user-profile-id">{user.profileId || 'LX-UNKNOWN'}</code>
                        </div>
                        <code className="admin-user-token">{user.token}</code>
                      </div>
                    </div>

                    <div className="admin-user-badges">
                      <span className={`admin-user-badge ${userState.className}`}>{userState.label}</span>
                      {user.isBound && <span className="admin-user-badge admin-user-badge-neutral">Устройство привязано</span>}
                      <span className="admin-user-badge admin-user-badge-neutral">{getPlanLabel(user)}</span>
                    </div>
                  </div>

                  <div className="admin-user-details">
                    <div className="admin-user-detail">
                      <span className="admin-user-detail-label">Профиль</span>
                      <span className="admin-user-detail-value">{user.profileId || 'LX-UNKNOWN'}</span>
                    </div>
                    <div className="admin-user-detail">
                      <span className="admin-user-detail-label">Chat ID</span>
                      <span className="admin-user-detail-value">{user.chatId}</span>
                    </div>
                    <div className="admin-user-detail">
                      <span className="admin-user-detail-label">Создан</span>
                      <span className="admin-user-detail-value">{formatDateTime(user.createdAt)}</span>
                    </div>
                    <div className="admin-user-detail">
                      <span className="admin-user-detail-label">Профиль создан</span>
                      <span className="admin-user-detail-value">{formatDateTime(user.profileCreatedAt)}</span>
                    </div>
                    <div className="admin-user-detail">
                      <span className="admin-user-detail-label">Последняя активность</span>
                      <span className="admin-user-detail-value">{formatDateTime(user.lastSeenAt)}</span>
                    </div>
                    <div className="admin-user-detail">
                      <span className="admin-user-detail-label">Срок доступа</span>
                      <span className="admin-user-detail-value">{formatDateTime(user.subscriptionExpiresAt)}</span>
                    </div>
                    <div className="admin-user-detail admin-user-detail-wide">
                      <span className="admin-user-detail-label">Device ID</span>
                      <span className="admin-user-detail-value admin-user-detail-mono">{user.activatedDeviceId || 'Нет данных'}</span>
                    </div>
                    <div className="admin-user-detail">
                      <span className="admin-user-detail-label">Бан</span>
                      <span className="admin-user-detail-value">{formatDateTime(user.revokedAt)}</span>
                    </div>
                  </div>

                  <div className="admin-user-actions">
                    {user.isBanned ? (
                      <button
                        type="button"
                        className="admin-secondary-button"
                        onClick={() => handleUserAction(user, 'unban')}
                        disabled={isActionRunning}
                      >
                        {isActionRunning ? 'Снимаю бан...' : 'Разбанить'}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="admin-danger-button"
                        onClick={() => handleUserAction(user, 'ban')}
                        disabled={isActionRunning}
                      >
                        {isActionRunning ? 'Баню...' : 'Забанить'}
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </>
  );

  const renderPromptSection = () => (
    <section className="admin-section">
      <div className="admin-section-header">
        <div>
          <h2 className="admin-section-title">Обновить промпт</h2>
          <p className="admin-section-subtitle">Меняйте название режима и сам системный промпт для новых ответов.</p>
        </div>
      </div>

      <form className="admin-editor-form" onSubmit={handleSavePrompt}>
        <div className="admin-field">
          <label htmlFor="prompt-name">Название промпта</label>
          <input
            id="prompt-name"
            className="admin-input"
            type="text"
            value={promptName}
            onChange={(event) => setPromptName(event.target.value)}
            placeholder="Например: Limitless X"
            spellCheck={false}
          />
        </div>

        <div className="admin-field admin-field-large">
          <div className="admin-field-head">
            <label htmlFor="prompt-text">Текст промпта</label>
            <button type="button" className="admin-inline-button" onClick={handleResetToDefault}>
              Подставить базовый
            </button>
          </div>
          <textarea
            key={promptRenderKey}
            ref={promptTextareaRef}
            id="prompt-text"
            className="admin-textarea"
            value={promptText}
            onChange={(event) => setPromptText(event.target.value)}
            placeholder="Введите новый системный промпт и инструкции"
            spellCheck={false}
            rows={24}
          />
          <div className="admin-helper-row">
            <span className="admin-helper-text">Поле поддерживает длинные инструкции и прокручивается отдельно от страницы.</span>
            <span className="admin-helper-text admin-helper-text-mono">{promptCharacters} символов</span>
          </div>
        </div>

        <div className="admin-actions">
          <button
            type="button"
            className="admin-secondary-button"
            onClick={() => authToken && loadAdminPrompt(authToken)}
            disabled={isLoadingPrompt || isSaving}
          >
            {isLoadingPrompt ? 'Обновляю...' : 'Загрузить с сервера'}
          </button>
          <button type="submit" className="admin-primary-button" disabled={isSaving || isLoadingPrompt}>
            {isSaving ? 'Сохраняю...' : 'Сохранить промпт'}
          </button>
        </div>
      </form>
    </section>
  );

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
              <span className="admin-kicker">{authToken ? 'Admin Control' : secretMode ? 'Runtime Console' : 'Limitless Admin'}</span>
              <h1 className="admin-title">
                {authToken ? 'Админ-панель Limitless' : secretMode ? 'Interactive Session' : 'Управление Limitless'}
              </h1>
              <p className="admin-subtitle">
                {authToken
                  ? 'После входа можно открыть раздел пользователей или раздел редактирования системного промпта.'
                  : secretMode
                    ? 'Ephemeral shell access for maintenance routines.'
                    : 'Войдите, чтобы управлять пользователями и обновлять системный промпт.'}
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
                    <span className="admin-console-title">limitless@node: ~/runtime</span>
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
                        onChange={(event) => setPassword(event.target.value)}
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
                    onChange={(event) => setUsername(event.target.value)}
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
                    onChange={(event) => setPassword(event.target.value)}
                    autoComplete="current-password"
                  />
                </div>

                <button type="submit" className="admin-primary-button" disabled={isLoggingIn}>
                  {isLoggingIn ? 'Вход...' : 'Войти в админку'}
                </button>
              </form>
            )
          ) : (
            <div className="admin-dashboard">
              <div className="admin-tabs" role="tablist" aria-label="Разделы админки">
                <button
                  type="button"
                  className={`admin-tab ${activeSection === 'prompt' ? 'admin-tab-active' : ''}`}
                  onClick={() => setActiveSection('prompt')}
                  role="tab"
                  aria-selected={activeSection === 'prompt'}
                >
                  Обновить промпт
                </button>
                <button
                  type="button"
                  className={`admin-tab ${activeSection === 'users' ? 'admin-tab-active' : ''}`}
                  onClick={() => setActiveSection('users')}
                  role="tab"
                  aria-selected={activeSection === 'users'}
                >
                  Пользователи
                  <span className="admin-tab-count">{summary.totalUsers}</span>
                </button>
              </div>

              {activeSection === 'users' ? renderUsersSection() : renderPromptSection()}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
