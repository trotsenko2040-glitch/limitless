import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AccountProfile, Chat, Message } from '../types';
import { Sidebar } from '../components/Sidebar';
import { SettingsModal } from '../components/SettingsModal';
import { CapsuleNav } from '../components/CapsuleNav';
import { MessageBubble } from '../components/MessageBubble';
import { TypingIndicator } from '../components/TypingIndicator';
import { fetchRemoteAccountSnapshot, saveRemoteAccountSnapshot } from '../utils/accountApi';
import {
  AccountSnapshot,
  createNewChat,
  generateChatTitle,
  generateId,
  hasMeaningfulAccountData,
  loadAccountSnapshot,
  loadAuthToken,
  loadOrCreateDeviceId,
  migrateLegacyAccountData,
  saveAccountSnapshot,
} from '../utils/storage';
import { DEFAULT_PROMPT_NAME, fetchPromptConfig } from '../utils/gemini';
import { getProviderApiKey, getProviderConfig, sendChatCompletion } from '../utils/aiProvider';
import './ChatPage.css';

interface ChatPageProps {
  onGoHome: () => void;
}

export const ChatPage: React.FC<ChatPageProps> = ({ onGoHome }) => {
  const authToken = React.useMemo(() => loadAuthToken(), []);
  const deviceId = React.useMemo(() => loadOrCreateDeviceId(), []);
  const initialAccountSnapshot = React.useMemo(
    () => (authToken ? migrateLegacyAccountData(authToken) : loadAccountSnapshot(null)),
    [authToken],
  );
  const [chats, setChats] = useState<Chat[]>(() => initialAccountSnapshot.chats);
  const [currentChatId, setCurrentChatId] = useState<string | null>(() => initialAccountSnapshot.currentChatId);
  const [profile, setProfile] = useState<AccountProfile>(() => initialAccountSnapshot.profile);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState('');
  const [promptName, setPromptName] = useState(DEFAULT_PROMPT_NAME);
  const [accountReady, setAccountReady] = useState(!authToken);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const currentChat = chats.find((chat) => chat.id === currentChatId) || null;

  useEffect(() => {
    if (!authToken) {
      setAccountReady(true);
      return;
    }

    let isCancelled = false;
    const localSnapshot = migrateLegacyAccountData(authToken);
    setChats(localSnapshot.chats);
    setCurrentChatId(localSnapshot.currentChatId);
    setProfile(localSnapshot.profile);

    const syncAccount = async () => {
      try {
        const remoteSnapshot = await fetchRemoteAccountSnapshot(authToken, deviceId);
        if (isCancelled) {
          return;
        }

        if (hasMeaningfulAccountData(remoteSnapshot)) {
          saveAccountSnapshot(remoteSnapshot, authToken);
          setChats(remoteSnapshot.chats);
          setCurrentChatId(remoteSnapshot.currentChatId);
          setProfile(remoteSnapshot.profile);
        } else if (hasMeaningfulAccountData(localSnapshot)) {
          await saveRemoteAccountSnapshot(authToken, deviceId, localSnapshot);
        }
      } catch {
        if (!isCancelled && !hasMeaningfulAccountData(localSnapshot)) {
          setError('Не удалось загрузить данные аккаунта. Локальный кеш пуст.');
        }
      } finally {
        if (!isCancelled) {
          setAccountReady(true);
        }
      }
    };

    syncAccount();

    return () => {
      isCancelled = true;
    };
  }, [authToken, deviceId]);

  useEffect(() => {
    if (!authToken || !accountReady) {
      return;
    }

    const nextSnapshot: AccountSnapshot = {
      chats,
      settings: loadAccountSnapshot(authToken).settings,
      currentChatId,
      profile,
      updatedAt: null,
    };

    saveAccountSnapshot(nextSnapshot, authToken);

    const timeoutId = window.setTimeout(() => {
      saveRemoteAccountSnapshot(authToken, deviceId, nextSnapshot).catch(() => {
        // Keep local state even if the server is temporarily unavailable.
      });
    }, 500);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [accountReady, authToken, chats, currentChatId, deviceId, profile]);

  const scrollToBottom = useCallback(() => {
    window.setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [currentChat?.messages.length, isGenerating, scrollToBottom]);

  useEffect(() => {
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

  const handleNewChat = useCallback(() => {
    const newChat = createNewChat();
    setChats((previous) => [newChat, ...previous]);
    setCurrentChatId(newChat.id);
    setSidebarOpen(false);
    setInputValue('');
    setError('');
    inputRef.current?.focus();
  }, []);

  const handleSelectChat = useCallback((chatId: string) => {
    setCurrentChatId(chatId);
    setSidebarOpen(false);
    setError('');
  }, []);

  const handleDeleteChat = useCallback((chatId: string) => {
    setChats((previous) => previous.filter((chat) => chat.id !== chatId));
    if (currentChatId === chatId) {
      setCurrentChatId(null);
    }
  }, [currentChatId]);

  const handleGoHomeClick = useCallback(() => {
    setSidebarOpen(false);
    onGoHome();
  }, [onGoHome]);

  const handleSendMessage = useCallback(async () => {
    const content = inputValue.trim();
    if (!content || isGenerating) {
      return;
    }

    const settings = loadAccountSnapshot(authToken).settings;
    if (!getProviderApiKey(settings, settings.providerId)) {
      setError(`API ключ не настроен. Откройте настройки и добавьте ключ ${getProviderConfig(settings.providerId).label}.`);
      return;
    }

    setError('');
    let chatId = currentChatId;
    let chatToUse = currentChat;

    if (!chatId || !chatToUse) {
      const newChat = createNewChat();
      chatToUse = newChat;
      chatId = newChat.id;
      setChats((previous) => [newChat, ...previous]);
      setCurrentChatId(chatId);
    }

    const userMessage: Message = {
      id: generateId(),
      role: 'user',
      content,
      timestamp: Date.now(),
    };

    const updatedChat: Chat = {
      ...chatToUse,
      messages: [...chatToUse.messages, userMessage],
      title: chatToUse.messages.length === 0 ? generateChatTitle(content) : chatToUse.title,
      updatedAt: Date.now(),
    };

    setChats((previous) => previous.map((chat) => (chat.id === chatId ? updatedChat : chat)));
    setInputValue('');
    setIsGenerating(true);

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      const responseText = await sendChatCompletion(
        updatedChat.messages,
        settings,
        abortController.signal,
      );

      const assistantMessage: Message = {
        id: generateId(),
        role: 'assistant',
        content: responseText,
        timestamp: Date.now(),
      };

      setChats((previous) =>
        previous.map((chat) => {
          if (chat.id !== chatId) {
            return chat;
          }

          return {
            ...chat,
            messages: [...chat.messages, assistantMessage],
            updatedAt: Date.now(),
          };
        }),
      );
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        setError(err?.message || 'Не удалось получить ответ от модели.');
      }
    } finally {
      setIsGenerating(false);
      abortControllerRef.current = null;
    }
  }, [authToken, currentChat, currentChatId, inputValue, isGenerating]);

  const handleStopGeneration = useCallback(() => {
    abortControllerRef.current?.abort();
    setIsGenerating(false);
  }, []);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        handleSendMessage();
      }
    },
    [handleSendMessage],
  );

  const handleInputChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputValue(event.target.value);
    const target = event.target;
    target.style.height = 'auto';
    target.style.height = `${Math.min(target.scrollHeight, 200)}px`;
  };

  return (
    <div className="chat-page">
      <div className="bg-orb bg-orb-1" />
      <div className="bg-orb bg-orb-2" />

      <Sidebar
        isOpen={sidebarOpen}
        chats={chats}
        currentChatId={currentChatId}
        onClose={() => setSidebarOpen(false)}
        onNewChat={handleNewChat}
        onSelectChat={handleSelectChat}
        onDeleteChat={handleDeleteChat}
        onOpenSettings={() => setSettingsOpen(true)}
        onGoHome={handleGoHomeClick}
      />

      {sidebarOpen && <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />}

      <div className="chat-main">
        <CapsuleNav
          onMenuClick={() => setSidebarOpen(true)}
          onNewChat={handleNewChat}
          chatTitle={currentChat?.title || promptName}
        />

        <div className="messages-container">
          {!currentChat || currentChat.messages.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">
                <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
                  <path d="M24 4L44 14V34L24 44L4 34V14L24 4Z" stroke="url(#empty-grad)" strokeWidth="2" fill="none" opacity="0.5" />
                  <path d="M24 12L36 18V30L24 36L12 30V18L24 12Z" fill="url(#empty-grad)" opacity="0.15" />
                  <path d="M24 20L30 23V29L24 32L18 29V23L24 20Z" fill="url(#empty-grad)" opacity="0.4" />
                  <defs>
                    <linearGradient id="empty-grad" x1="4" y1="4" x2="44" y2="44">
                      <stop stopColor="#a78bfa" />
                      <stop offset="1" stopColor="#6d28d9" />
                    </linearGradient>
                  </defs>
                </svg>
              </div>
              <h2 className="empty-state-title">{promptName}</h2>
              <p className="empty-state-text">Начните диалог с нейросетью</p>
              <div className="empty-state-hints">
                {['Что ты умеешь?', '.help', '.helpWL'].map((hint, index) => (
                  <button
                    key={index}
                    className="hint-chip"
                    onClick={() => {
                      setInputValue(hint);
                      inputRef.current?.focus();
                    }}
                  >
                    {hint}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="messages-list">
              {currentChat.messages.map((message, index) => (
                <MessageBubble key={message.id} message={message} index={index} />
              ))}
              {isGenerating && <TypingIndicator />}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {error && (
          <div className="chat-error animate-fade-in-up">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span>{error}</span>
            <button className="error-close" onClick={() => setError('')}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        )}

        <div className="input-container">
          <div className="input-wrapper">
            <textarea
              ref={inputRef}
              className="chat-input"
              placeholder="Введите сообщение..."
              value={inputValue}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              rows={1}
              disabled={isGenerating}
            />
            <div className="input-actions">
              {isGenerating ? (
                <button className="stop-button" onClick={handleStopGeneration} title="Остановить">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                    <rect x="6" y="6" width="12" height="12" rx="2" />
                  </svg>
                </button>
              ) : (
                <button
                  className={`send-button ${inputValue.trim() ? 'active' : ''}`}
                  onClick={handleSendMessage}
                  disabled={!inputValue.trim()}
                  title="Отправить"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="22" y1="2" x2="11" y2="13" />
                    <polygon points="22 2 15 22 11 13 2 9 22 2" />
                  </svg>
                </button>
              )}
            </div>
          </div>
          <p className="input-hint">{promptName} • Enter — отправить, Shift+Enter — новая строка</p>
        </div>
      </div>

      {settingsOpen && (
        <SettingsModal
          profile={profile}
          onProfileSaved={setProfile}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
};
