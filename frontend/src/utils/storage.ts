import { Chat, Message, UserSettings } from '../types';

const CHATS_KEY = 'limitless_chats';
const SETTINGS_KEY = 'limitless_settings';
const AUTH_KEY = 'limitless_auth_token';
const CURRENT_CHAT_KEY = 'limitless_current_chat';

export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

export function saveChats(chats: Chat[]): void {
  localStorage.setItem(CHATS_KEY, JSON.stringify(chats));
}

export function loadChats(): Chat[] {
  const data = localStorage.getItem(CHATS_KEY);
  return data ? JSON.parse(data) : [];
}

export function saveSettings(settings: UserSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function loadSettings(): UserSettings {
  const data = localStorage.getItem(SETTINGS_KEY);
  return data ? JSON.parse(data) : { geminiApiKey: '', theme: 'dark' };
}

export function saveAuthToken(token: string): void {
  localStorage.setItem(AUTH_KEY, token);
}

export function loadAuthToken(): string | null {
  return localStorage.getItem(AUTH_KEY);
}

export function clearAuthToken(): void {
  localStorage.removeItem(AUTH_KEY);
}

export function saveCurrentChatId(id: string): void {
  localStorage.setItem(CURRENT_CHAT_KEY, id);
}

export function loadCurrentChatId(): string | null {
  return localStorage.getItem(CURRENT_CHAT_KEY);
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
  return clean.length > maxLen ? clean.substring(0, maxLen) + '...' : clean;
}
