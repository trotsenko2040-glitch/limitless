export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export interface Chat {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
}

export interface UserSettings {
  providerId: 'sosiskibot' | 'gemini';
  apiKey: string;
  providerApiKeys: Partial<Record<'sosiskibot' | 'gemini', string>>;
  selectedModelId: string;
  providerModelIds: Partial<Record<'sosiskibot' | 'gemini', string>>;
  autoFallbackEnabled: boolean;
  theme: 'dark' | 'light';
}

export interface AccountProfile {
  profileId: string;
  nickname: string;
  avatarDataUrl: string | null;
  avatarHue: number;
  createdAt?: string | null;
}

export interface AuthState {
  isAuthenticated: boolean;
  token: string | null;
}
