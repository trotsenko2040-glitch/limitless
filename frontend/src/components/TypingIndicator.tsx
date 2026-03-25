import React from 'react';
import './TypingIndicator.css';

export const TypingIndicator: React.FC = () => {
  return (
    <div className="typing-indicator-wrapper">
      <div className="typing-avatar">
        <svg width="18" height="18" viewBox="0 0 40 40" fill="none">
          <path d="M20 6L34 14V26L20 34L6 26V14L20 6Z" fill="url(#typ-grad)" opacity="0.6" />
          <path d="M20 14L28 18V26L20 30L12 26V18L20 14Z" fill="url(#typ-grad)" />
          <defs>
            <linearGradient id="typ-grad" x1="6" y1="6" x2="34" y2="34">
              <stop stopColor="#a78bfa" />
              <stop offset="1" stopColor="#6d28d9" />
            </linearGradient>
          </defs>
        </svg>
      </div>
      <div className="typing-indicator">
        <span className="typing-dot" />
        <span className="typing-dot" />
        <span className="typing-dot" />
      </div>
    </div>
  );
};
