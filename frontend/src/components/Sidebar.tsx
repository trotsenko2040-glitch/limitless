import React from 'react';
import { Chat } from '../types';
import './Sidebar.css';

interface SidebarProps {
  isOpen: boolean;
  chats: Chat[];
  currentChatId: string | null;
  onClose: () => void;
  onNewChat: () => void;
  onSelectChat: (id: string) => void;
  onDeleteChat: (id: string) => void;
  onOpenSettings: () => void;
  onLogout: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  isOpen, chats, currentChatId, onClose, onNewChat,
  onSelectChat, onDeleteChat, onOpenSettings, onLogout,
}) => {
  const formatDate = (ts: number) => {
    const d = new Date(ts);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const days = Math.floor(diff / 86400000);
    if (days === 0) return 'Сегодня';
    if (days === 1) return 'Вчера';
    if (days < 7) return `${days} дн. назад`;
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  };

  return (
    <aside className={`sidebar ${isOpen ? 'open' : ''}`}>
      <div className="sidebar-header">
        <div className="sidebar-brand">
          <svg width="24" height="24" viewBox="0 0 40 40" fill="none">
            <path d="M20 4L36 12V28L20 36L4 28V12L20 4Z" stroke="url(#sb-grad)" strokeWidth="2" fill="none" />
            <path d="M20 14L28 18V26L20 30L12 26V18L20 14Z" fill="url(#sb-grad)" opacity="0.4" />
            <defs>
              <linearGradient id="sb-grad" x1="4" y1="4" x2="36" y2="36">
                <stop stopColor="#a78bfa" />
                <stop offset="1" stopColor="#6d28d9" />
              </linearGradient>
            </defs>
          </svg>
          <span className="sidebar-brand-text">LIMITLESS</span>
        </div>
        <button className="sidebar-close" onClick={onClose}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <button className="new-chat-button" onClick={onNewChat}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        <span>Новый чат</span>
      </button>

      <div className="sidebar-chats">
        {chats.length === 0 ? (
          <div className="sidebar-empty">
            <p>Нет чатов</p>
            <p className="sidebar-empty-hint">Начните новый диалог</p>
          </div>
        ) : (
          chats.map((chat, index) => (
            <div
              key={chat.id}
              className={`chat-item ${chat.id === currentChatId ? 'active' : ''}`}
              onClick={() => onSelectChat(chat.id)}
              style={{ animationDelay: `${index * 30}ms` }}
            >
              <div className="chat-item-content">
                <div className="chat-item-icon">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                </div>
                <div className="chat-item-info">
                  <span className="chat-item-title">{chat.title}</span>
                  <span className="chat-item-date">{formatDate(chat.updatedAt)}</span>
                </div>
              </div>
              <button
                className="chat-item-delete"
                onClick={(e) => { e.stopPropagation(); onDeleteChat(chat.id); }}
                title="Удалить чат"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
              </button>
            </div>
          ))
        )}
      </div>

      <div className="sidebar-footer">
        <button className="sidebar-footer-btn" onClick={onOpenSettings}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
          <span>Настройки</span>
        </button>
        <button className="sidebar-footer-btn logout-btn" onClick={onLogout}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
          <span>Выход</span>
        </button>
      </div>
    </aside>
  );
};
