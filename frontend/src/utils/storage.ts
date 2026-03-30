import { AccountProfile, Chat, UserSettings } from '../types';
import { DEFAULT_AI_PROVIDER_ID, getDefaultModelId } from './aiProvider';
import { normalizeAccountProfile } from './profile';

const LEGACY_CHATS_KEY = 'limitless_chats';
const LEGACY_SETTINGS_KEY = 'limitless_settings';
const LEGACY_CURRENT_CHAT_KEY = 'limitless_current_chat';
const AUTH_KEY = 'limitless_auth_token';
const ADMIN_AUTH_KEY = 'limitless_admin_auth_token';
const DEVICE_KEY = 'limitless_device_id';

const ACCOUNT_SCOPE_PREFIX = 'limitless_account';
const CHATS_SUFFIX = 'chats';
const SETTINGS_SUFFIX = 'settings';
const CURRENT_CHAT_SUFFIX = 'current_chat';
const PROFILE_SUFFIX = 'profile';
const LEGACY_PROFILE_KEY = 'limitless_profile';

export interface AccountSnapshot {
  chats: Chat[];
  settings: UserSettings;
  currentChatId: string | null;
  profile: AccountProfile;
  updatedAt?: string | null;
}

type StoredSettings = Partial<UserSettings> & {
  geminiApiKey?: string;
  provider?: string;
  providerId?: string;
  aiProvider?: string;
  selectedModel?: string;
  model?: string;
  providerApiKeys?: Partial<Record<'sosiskibot' | 'gemini', string>>;
  providerModelIds?: Partial<Record<'sosiskibot' | 'gemini', string>>;
  autoFallbackEnabled?: boolean;
};

type StoredAccountSnapshot = Omit<Partial<AccountSnapshot>, 'settings' | 'profile'> & {
  settings?: StoredSettings | null;
  profile?: Partial<AccountProfile> | null;
};

function createDefaultSettings(): UserSettings {
  return {
    providerId: DEFAULT_AI_PROVIDER_ID,
    apiKey: '',
    providerApiKeys: {},
    selectedModelId: getDefaultModelId(DEFAULT_AI_PROVIDER_ID),
    providerModelIds: {
      [DEFAULT_AI_PROVIDER_ID]: getDefaultModelId(DEFAULT_AI_PROVIDER_ID),
    },
    autoFallbackEnabled: true,
    theme: 'dark',
  };
}

function createEmptyAccountSnapshot(token?: string | null): AccountSnapshot {
  return {
    chats: [],
    settings: createDefaultSettings(),
    currentChatId: null,
    profile: normalizeAccountProfile(undefined, token),
    updatedAt: null,
  };
}

function safeJsonParse<T>(value: string | null, fallback: T): T {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function normalizeSettings(settings?: StoredSettings | null): UserSettings {
  const theme = settings?.theme === 'light' ? 'light' : 'dark';
  const providerSource = typeof settings?.providerId === 'string'
    ? settings.providerId
    : typeof settings?.provider === 'string'
      ? settings.provider
      : typeof settings?.aiProvider === 'string'
        ? settings.aiProvider
        : DEFAULT_AI_PROVIDER_ID;
  const apiKeySource = typeof settings?.apiKey === 'string'
    ? settings.apiKey
    : typeof settings?.geminiApiKey === 'string'
      ? settings.geminiApiKey
      : '';
  const selectedModelSource = typeof settings?.selectedModelId === 'string'
    ? settings.selectedModelId
    : typeof settings?.selectedModel === 'string'
      ? settings.selectedModel
      : typeof settings?.model === 'string'
        ? settings.model
        : '';

  const providerId = providerSource === 'gemini' ? 'gemini' : DEFAULT_AI_PROVIDER_ID;
  const rawProviderApiKeys = settings?.providerApiKeys ?? {};
  const rawProviderModelIds = settings?.providerModelIds ?? {};

  const providerApiKeys: Partial<Record<'sosiskibot' | 'gemini', string>> = {
    sosiskibot: typeof rawProviderApiKeys.sosiskibot === 'string' ? rawProviderApiKeys.sosiskibot.trim() : '',
    gemini: typeof rawProviderApiKeys.gemini === 'string'
      ? rawProviderApiKeys.gemini.trim()
      : typeof settings?.geminiApiKey === 'string'
        ? settings.geminiApiKey.trim()
        : '',
  };

  if (!providerApiKeys[providerId] && apiKeySource.trim()) {
    providerApiKeys[providerId] = apiKeySource.trim();
  }

  const providerModelIds: Partial<Record<'sosiskibot' | 'gemini', string>> = {
    sosiskibot: typeof rawProviderModelIds.sosiskibot === 'string' && rawProviderModelIds.sosiskibot.trim()
      ? rawProviderModelIds.sosiskibot.trim()
      : providerId === 'sosiskibot' && selectedModelSource.trim()
        ? selectedModelSource.trim()
        : getDefaultModelId('sosiskibot'),
    gemini: typeof rawProviderModelIds.gemini === 'string' && rawProviderModelIds.gemini.trim()
      ? rawProviderModelIds.gemini.trim()
      : providerId === 'gemini' && selectedModelSource.trim()
        ? selectedModelSource.trim()
        : getDefaultModelId('gemini'),
  };

  const currentApiKey = providerApiKeys[providerId]?.trim() || '';
  const currentModelId = providerModelIds[providerId]?.trim() || getDefaultModelId(providerId);

  return {
    providerId,
    apiKey: currentApiKey,
    providerApiKeys,
    selectedModelId: currentModelId,
    providerModelIds,
    autoFallbackEnabled: settings?.autoFallbackEnabled !== false,
    theme,
  };
}

export function normalizeStoredAccountSnapshot(snapshot?: StoredAccountSnapshot | null, token?: string | null): AccountSnapshot {
  return {
    chats: Array.isArray(snapshot?.chats) ? snapshot.chats : [],
    settings: normalizeSettings(snapshot?.settings as StoredSettings | undefined),
    currentChatId: typeof snapshot?.currentChatId === 'string' ? snapshot.currentChatId : null,
    profile: normalizeAccountProfile(snapshot?.profile as Partial<AccountProfile> | null, token),
    updatedAt: typeof snapshot?.updatedAt === 'string' ? snapshot.updatedAt : null,
  };
}

function getScopedKey(token: string, suffix: string): string {
  return `${ACCOUNT_SCOPE_PREFIX}:${token}:${suffix}`;
}

function resolveToken(token?: string | null): string | null {
  return token ?? loadAuthToken();
}

function loadScopedChats(token: string): Chat[] {
  return safeJsonParse<Chat[]>(localStorage.getItem(getScopedKey(token, CHATS_SUFFIX)), []);
}

function loadScopedSettings(token: string): UserSettings {
  return normalizeSettings(safeJsonParse<StoredSettings>(
    localStorage.getItem(getScopedKey(token, SETTINGS_SUFFIX)),
    createDefaultSettings(),
  ));
}

function loadScopedCurrentChatId(token: string): string | null {
  return localStorage.getItem(getScopedKey(token, CURRENT_CHAT_SUFFIX));
}

function loadScopedProfile(token: string): AccountProfile {
  return normalizeAccountProfile(
    safeJsonParse<Partial<AccountProfile> | null>(
      localStorage.getItem(getScopedKey(token, PROFILE_SUFFIX)),
      null,
    ),
    token,
  );
}

function saveScopedChats(token: string, chats: Chat[]): void {
  localStorage.setItem(getScopedKey(token, CHATS_SUFFIX), JSON.stringify(chats));
}

function saveScopedSettings(token: string, settings: UserSettings): void {
  localStorage.setItem(getScopedKey(token, SETTINGS_SUFFIX), JSON.stringify(normalizeSettings(settings)));
}

function saveScopedCurrentChatId(token: string, id: string | null): void {
  const scopedKey = getScopedKey(token, CURRENT_CHAT_SUFFIX);
  if (id) {
    localStorage.setItem(scopedKey, id);
  } else {
    localStorage.removeItem(scopedKey);
  }
}

function saveScopedProfile(token: string, profile: AccountProfile): void {
  localStorage.setItem(getScopedKey(token, PROFILE_SUFFIX), JSON.stringify(profile));
}

function hasScopedAccountData(token: string): boolean {
  return (
    localStorage.getItem(getScopedKey(token, CHATS_SUFFIX)) !== null ||
    localStorage.getItem(getScopedKey(token, SETTINGS_SUFFIX)) !== null ||
    localStorage.getItem(getScopedKey(token, CURRENT_CHAT_SUFFIX)) !== null ||
    localStorage.getItem(getScopedKey(token, PROFILE_SUFFIX)) !== null
  );
}

function loadLegacyAccountSnapshot(): AccountSnapshot {
  return normalizeStoredAccountSnapshot(
    {
      chats: safeJsonParse<Chat[]>(localStorage.getItem(LEGACY_CHATS_KEY), []),
      settings: safeJsonParse<StoredSettings>(localStorage.getItem(LEGACY_SETTINGS_KEY), createDefaultSettings()),
      currentChatId: localStorage.getItem(LEGACY_CURRENT_CHAT_KEY),
      profile: safeJsonParse<Partial<AccountProfile> | null>(localStorage.getItem(LEGACY_PROFILE_KEY), null),
      updatedAt: null,
    },
    null,
  );
}

function saveLegacyAccountSnapshot(snapshot: AccountSnapshot): void {
  const normalized = normalizeStoredAccountSnapshot(snapshot, null);
  localStorage.setItem(LEGACY_CHATS_KEY, JSON.stringify(normalized.chats));
  localStorage.setItem(LEGACY_SETTINGS_KEY, JSON.stringify(normalized.settings));
  localStorage.setItem(LEGACY_PROFILE_KEY, JSON.stringify(normalized.profile));
  if (normalized.currentChatId) {
    localStorage.setItem(LEGACY_CURRENT_CHAT_KEY, normalized.currentChatId);
  } else {
    localStorage.removeItem(LEGACY_CURRENT_CHAT_KEY);
  }
}

function clearLegacyAccountSnapshot(): void {
  localStorage.removeItem(LEGACY_CHATS_KEY);
  localStorage.removeItem(LEGACY_SETTINGS_KEY);
  localStorage.removeItem(LEGACY_CURRENT_CHAT_KEY);
  localStorage.removeItem(LEGACY_PROFILE_KEY);
}

export function hasMeaningfulAccountData(snapshot: AccountSnapshot): boolean {
  return (
    snapshot.chats.length > 0 ||
    Boolean(snapshot.currentChatId) ||
    Boolean(snapshot.settings.apiKey.trim()) ||
    Object.values(snapshot.settings.providerApiKeys || {}).some((value) => Boolean(value?.trim())) ||
    Boolean(snapshot.profile.avatarDataUrl)
  );
}

export function loadAccountSnapshot(token?: string | null): AccountSnapshot {
  const resolvedToken = resolveToken(token);
  if (!resolvedToken) {
    return loadLegacyAccountSnapshot();
  }

  return normalizeStoredAccountSnapshot({
    chats: loadScopedChats(resolvedToken),
    settings: loadScopedSettings(resolvedToken),
    currentChatId: loadScopedCurrentChatId(resolvedToken),
    profile: loadScopedProfile(resolvedToken),
    updatedAt: null,
  }, resolvedToken);
}

export function saveAccountSnapshot(snapshot: AccountSnapshot, token?: string | null): void {
  const resolvedToken = resolveToken(token);
  const normalized = normalizeStoredAccountSnapshot(snapshot, resolvedToken);
  if (!resolvedToken) {
    saveLegacyAccountSnapshot(normalized);
    return;
  }

  saveScopedChats(resolvedToken, normalized.chats);
  saveScopedSettings(resolvedToken, normalized.settings);
  saveScopedCurrentChatId(resolvedToken, normalized.currentChatId);
  saveScopedProfile(resolvedToken, normalizeAccountProfile(normalized.profile, resolvedToken));
}

export function migrateLegacyAccountData(token: string): AccountSnapshot {
  if (!token) {
    return loadLegacyAccountSnapshot();
  }

  if (hasScopedAccountData(token)) {
    return loadAccountSnapshot(token);
  }

  const legacySnapshot = loadLegacyAccountSnapshot();
  if (hasMeaningfulAccountData(legacySnapshot)) {
    saveAccountSnapshot(legacySnapshot, token);
    clearLegacyAccountSnapshot();
  }

  return loadAccountSnapshot(token);
}

export function migrateAccountStorage(sourceToken: string, targetToken: string): void {
  if (!sourceToken || !targetToken || sourceToken === targetToken) {
    return;
  }

  if (hasScopedAccountData(targetToken)) {
    return;
  }

  const sourceSnapshot = loadAccountSnapshot(sourceToken);
  if (hasMeaningfulAccountData(sourceSnapshot)) {
    saveAccountSnapshot(sourceSnapshot, targetToken);
  }
}

export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 11);
}

export function saveChats(chats: Chat[], token?: string | null): void {
  const snapshot = loadAccountSnapshot(token);
  saveAccountSnapshot({ ...snapshot, chats }, token);
}

export function loadChats(token?: string | null): Chat[] {
  return loadAccountSnapshot(token).chats;
}

export function saveSettings(settings: UserSettings, token?: string | null): void {
  const snapshot = loadAccountSnapshot(token);
  saveAccountSnapshot({ ...snapshot, settings }, token);
}

export function loadSettings(token?: string | null): UserSettings {
  return loadAccountSnapshot(token).settings;
}

export function saveProfile(profile: AccountProfile, token?: string | null): void {
  const snapshot = loadAccountSnapshot(token);
  saveAccountSnapshot({ ...snapshot, profile }, token);
}

export function loadProfile(token?: string | null): AccountProfile {
  return loadAccountSnapshot(token).profile;
}

export function saveAuthToken(token: string): void {
  localStorage.setItem(AUTH_KEY, token);
}

export function loadAuthToken(): string | null {
  return localStorage.getItem(AUTH_KEY);
}

export function loadOrCreateDeviceId(): string {
  const existingId = localStorage.getItem(DEVICE_KEY);
  if (existingId) {
    return existingId;
  }

  const deviceId = globalThis.crypto?.randomUUID?.() ?? `device-${generateId()}${generateId()}`;
  localStorage.setItem(DEVICE_KEY, deviceId);
  return deviceId;
}

export function clearAuthToken(): void {
  localStorage.removeItem(AUTH_KEY);
}

export function saveAdminAuthToken(token: string): void {
  localStorage.setItem(ADMIN_AUTH_KEY, token);
}

export function loadAdminAuthToken(): string | null {
  return localStorage.getItem(ADMIN_AUTH_KEY);
}

export function clearAdminAuthToken(): void {
  localStorage.removeItem(ADMIN_AUTH_KEY);
}

export function saveCurrentChatId(id: string | null, token?: string | null): void {
  const snapshot = loadAccountSnapshot(token);
  saveAccountSnapshot({ ...snapshot, currentChatId: id }, token);
}

export function loadCurrentChatId(token?: string | null): string | null {
  return loadAccountSnapshot(token).currentChatId;
}

export function createNewChat(): Chat {
  return {
    id: generateId(),
    title: 'Новый чат',
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export function generateChatTitle(firstMessage: string): string {
  const maxLen = 35;
  const clean = firstMessage.replace(/\n/g, ' ').trim();
  return clean.length > maxLen ? `${clean.substring(0, maxLen)}...` : clean;
}
