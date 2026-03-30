import { Message, UserSettings } from '../types';
import { fetchApi } from './api';
import {
  fetchPromptConfig,
  GEMINI_MODEL_DESCRIPTION,
  GEMINI_MODEL_ID,
  GEMINI_MODEL_LABEL,
  sendMessageToGemini,
} from './gemini';

export type AIProviderId = 'sosiskibot' | 'gemini';

export const DEFAULT_AI_PROVIDER_ID: AIProviderId = 'sosiskibot';
export const DEFAULT_CHAT_MODEL_ID = 'gpt-5.2-chat-latest';

export interface AIModelOption {
  id: string;
  label: string;
  description: string;
}

export interface AIProviderOption {
  id: AIProviderId;
  label: string;
  description: string;
  docsUrl: string;
}

const PROVIDERS: Record<AIProviderId, AIProviderOption> = {
  sosiskibot: {
    id: 'sosiskibot',
    label: 'SosiskiBot API',
    description: 'OpenAI-совместимый API со списком моделей и чат-комплишенами.',
    docsUrl: 'https://sosiskibot.ru/dashboard/docs',
  },
  gemini: {
    id: 'gemini',
    label: 'Gemini',
    description: 'Прямое подключение к Google Gemini по API ключу.',
    docsUrl: 'https://aistudio.google.com/app/apikey',
  },
};

const FALLBACK_CHAT_MODELS: AIModelOption[] = [
  {
    id: 'gpt-5.2-chat-latest',
    label: 'gpt-5.2-chat-latest',
    description: 'Базовая текстовая версия по умолчанию.',
  },
  {
    id: 'gpt-5.4',
    label: 'gpt-5.4',
    description: 'Более сильная версия для сложных ответов.',
  },
  {
    id: 'gpt-4o',
    label: 'gpt-4o',
    description: 'Мультимодальная версия для текста и изображений.',
  },
];

const GEMINI_MODELS: AIModelOption[] = [
  {
    id: GEMINI_MODEL_ID,
    label: GEMINI_MODEL_LABEL,
    description: GEMINI_MODEL_DESCRIPTION,
  },
];

const TRANSIENT_PROVIDER_ERRORS = [
  'AI_PROVIDER_RATE_LIMITED',
  'AI_PROVIDER_UNAVAILABLE',
  'high demand',
  'rate limit',
  'try again later',
  'temporarily unavailable',
  'quota exceeded',
  'resource exhausted',
  'overloaded',
];

export function getProviderOptions(): AIProviderOption[] {
  return Object.values(PROVIDERS);
}

export function getProviderConfig(providerId?: string | null): AIProviderOption {
  if (providerId === 'gemini') {
    return PROVIDERS.gemini;
  }

  return PROVIDERS.sosiskibot;
}

export function getDefaultModelId(providerId?: string | null): string {
  return providerId === 'gemini' ? GEMINI_MODEL_ID : DEFAULT_CHAT_MODEL_ID;
}

export function getProviderApiKey(settings: UserSettings, providerId: AIProviderId): string {
  const scopedKey = settings.providerApiKeys?.[providerId]?.trim();
  if (scopedKey) {
    return scopedKey;
  }

  return settings.providerId === providerId ? settings.apiKey.trim() : '';
}

export function getProviderModelId(settings: UserSettings, providerId: AIProviderId): string {
  const scopedModelId = settings.providerModelIds?.[providerId]?.trim();
  if (scopedModelId) {
    return scopedModelId;
  }

  if (settings.providerId === providerId && settings.selectedModelId.trim()) {
    return settings.selectedModelId.trim();
  }

  return getDefaultModelId(providerId);
}

function isTransientProviderError(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  return TRANSIENT_PROVIDER_ERRORS.some((pattern) => normalized.includes(pattern.toLowerCase()));
}

function getFallbackProviderId(providerId: AIProviderId): AIProviderId {
  return providerId === 'sosiskibot' ? 'gemini' : 'sosiskibot';
}

async function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    throw new DOMException('The operation was aborted.', 'AbortError');
  }

  await new Promise<void>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      window.clearTimeout(timeoutId);
      reject(new DOMException('The operation was aborted.', 'AbortError'));
    };

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function normalizeModelDescription(model: Record<string, unknown>): string {
  const ownedBy = typeof model.owned_by === 'string' ? model.owned_by.trim() : '';
  const objectType = typeof model.object === 'string' ? model.object.trim() : '';

  if (ownedBy) {
    return `OpenAI-совместимая модель (${ownedBy}).`;
  }

  if (objectType) {
    return `OpenAI-совместимая модель типа ${objectType}.`;
  }

  return 'OpenAI-совместимая модель для текстового чата.';
}

function normalizeModelsPayload(payload: unknown): AIModelOption[] {
  const rawModels = Array.isArray((payload as { data?: unknown[] } | null)?.data)
    ? (payload as { data: unknown[] }).data
    : Array.isArray(payload)
      ? payload
      : [];

  const normalized = rawModels
    .map((entry) => {
      if (!entry || typeof entry !== 'object') {
        return null;
      }

      const model = entry as Record<string, unknown>;
      const id = typeof model.id === 'string' ? model.id.trim() : '';
      if (!id) {
        return null;
      }

      return {
        id,
        label: id,
        description: normalizeModelDescription(model),
      } satisfies AIModelOption;
    })
    .filter((entry): entry is AIModelOption => Boolean(entry));

  return normalized.length > 0 ? normalized : FALLBACK_CHAT_MODELS;
}

function normalizeMessageContent(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }

  if (!Array.isArray(content)) {
    return '';
  }

  return content
    .map((part) => {
      if (typeof part === 'string') {
        return part;
      }

      if (!part || typeof part !== 'object') {
        return '';
      }

      const record = part as Record<string, unknown>;
      if (typeof record.text === 'string') {
        return record.text;
      }

      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function resolveProviderError(error?: string): string {
  if (!error) {
    return 'Не удалось получить ответ от AI API.';
  }

  const normalized = error.trim();
  const lower = normalized.toLowerCase();

  if (
    normalized === 'AI_PROVIDER_AUTH_FAILED' ||
    lower.includes('invalid api key') ||
    lower.includes('unauthorized')
  ) {
    return 'Неверный API ключ. Проверьте его в настройках.';
  }

  if (
    normalized === 'AI_PROVIDER_RATE_LIMITED' ||
    lower.includes('high demand') ||
    lower.includes('rate limit') ||
    lower.includes('try again later')
  ) {
    return 'Модель сейчас перегружена. Попробуйте еще раз чуть позже.';
  }

  if (
    normalized === 'AI_PROVIDER_UNAVAILABLE' ||
    lower.includes('temporarily unavailable')
  ) {
    return 'AI API временно недоступен. Попробуйте позже.';
  }

  if (normalized === 'AI_PROVIDER_MODELS_PARSE_FAILED') {
    return 'API вернул список моделей в неожиданном формате.';
  }

  if (normalized === 'AI_PROVIDER_RESPONSE_PARSE_FAILED') {
    return 'AI API вернул неожиданный ответ.';
  }

  if (normalized === 'AI_PROVIDER_BAD_REQUEST') {
    return 'Запрос к AI API составлен некорректно.';
  }

  return normalized;
}

export async function fetchAvailableModels(
  providerId: AIProviderId,
  apiKey: string,
  signal?: AbortSignal,
): Promise<AIModelOption[]> {
  if (providerId === 'gemini') {
    return GEMINI_MODELS;
  }

  if (!apiKey.trim()) {
    return getFallbackModels(providerId);
  }

  const response = await fetchApi(
    '/api/ai/models',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: apiKey.trim() }),
      signal,
    },
    20000,
  );

  if (!response.ok) {
    const errorPayload = await response.json().catch(() => ({}));
    throw new Error(resolveProviderError(errorPayload?.error));
  }

  const payload = await response.json();
  return normalizeModelsPayload(payload);
}

async function sendChatCompletionViaProvider(
  messages: Message[],
  providerId: AIProviderId,
  apiKey: string,
  model: string,
  signal?: AbortSignal,
): Promise<string> {
  const trimmedApiKey = apiKey.trim();
  if (!trimmedApiKey) {
    throw new Error(`API ключ не настроен. Откройте настройки и добавьте ключ ${getProviderConfig(providerId).label}.`);
  }

  if (providerId === 'gemini') {
    return sendMessageToGemini(messages, trimmedApiKey, signal);
  }

  const promptConfig = await fetchPromptConfig(signal);
  const response = await fetchApi(
    '/api/ai/chat/completions',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiKey: trimmedApiKey,
        model: model.trim() || DEFAULT_CHAT_MODEL_ID,
        messages: [
          { role: 'system', content: promptConfig.prompt },
          ...messages.map((message) => ({
            role: message.role,
            content: message.content,
          })),
        ],
      }),
      signal,
    },
    90000,
  );

  if (!response.ok) {
    const errorPayload = await response.json().catch(() => ({}));
    throw new Error(resolveProviderError(errorPayload?.error));
  }

  const payload = await response.json();
  const content = normalizeMessageContent(payload?.choices?.[0]?.message?.content);
  if (!content.trim()) {
    throw new Error('AI API вернул пустой ответ.');
  }

  return content;
}

export async function sendChatCompletion(
  messages: Message[],
  settings: UserSettings,
  signal?: AbortSignal,
): Promise<string> {
  const primaryProviderId = settings.providerId;
  const primaryApiKey = getProviderApiKey(settings, primaryProviderId);
  const primaryModelId = getProviderModelId(settings, primaryProviderId);

  try {
    return await sendChatCompletionViaProvider(
      messages,
      primaryProviderId,
      primaryApiKey,
      primaryModelId,
      signal,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'AI API временно недоступен.';
    if (!settings.autoFallbackEnabled || !isTransientProviderError(message)) {
      throw error;
    }

    try {
      await delay(800, signal);
      return await sendChatCompletionViaProvider(
        messages,
        primaryProviderId,
        primaryApiKey,
        primaryModelId,
        signal,
      );
    } catch (retryError) {
      const retryMessage = retryError instanceof Error ? retryError.message : message;
      if (!isTransientProviderError(retryMessage)) {
        throw retryError;
      }

      const fallbackProviderId = getFallbackProviderId(primaryProviderId);
      const fallbackApiKey = getProviderApiKey(settings, fallbackProviderId);
      if (!fallbackApiKey) {
        throw retryError;
      }

      return sendChatCompletionViaProvider(
        messages,
        fallbackProviderId,
        fallbackApiKey,
        getProviderModelId(settings, fallbackProviderId),
        signal,
      );
    }
  }
}

export function getFallbackModels(providerId: AIProviderId = DEFAULT_AI_PROVIDER_ID): AIModelOption[] {
  return providerId === 'gemini' ? GEMINI_MODELS : FALLBACK_CHAT_MODELS;
}
