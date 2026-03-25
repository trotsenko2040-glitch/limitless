import React from 'react';
import './CapsuleNav.css';

interface CapsuleNavProps {
  onMenuClick: () => void;
  onNewChat: () => void;
  chatTitle: string;
}

export const CapsuleNav: React.FC<CapsuleNavProps> = ({ onMenuClick, onNewChat, chatTitle }) => {
  return (
    <div className="capsule-nav-wrapper">
      <nav className="capsule-nav">
        <button className="capsule-btn menu-btn" onClick={onMenuClick} title="Меню">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>

        <div className="capsule-title-area">
          <div className="capsule-status-dot" />
          <span className="capsule-title">{chatTitle}</span>
        </div>

        <button className="capsule-btn new-btn" onClick={onNewChat} title="Новый чат">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
          </svg>
        </button>
      </nav>
    </div>
  );
};
