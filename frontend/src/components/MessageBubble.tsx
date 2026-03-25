import React from 'react';
import { Message } from '../types';
import './MessageBubble.css';

interface MessageBubbleProps {
  message: Message;
  index: number;
  isStreaming?: boolean;
}

export const MessageBubble: React.FC<MessageBubbleProps> = ({ message, index, isStreaming }) => {
  const isUser = message.role === 'user';

  const formatContent = (text: string) => {
    // Simple markdown-like formatting
    let html = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // Code blocks
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
      return `<pre class="code-block"><code class="lang-${lang}">${code.trim()}</code></pre>`;
    });

    // Inline code
    html = html.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');

    // Bold
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

    // Links
    html = html.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');

    // Line breaks
    html = html.replace(/\n/g, '<br/>');

    return html;
  };

  return (
    <div
      className={`message ${isUser ? 'message-user' : 'message-assistant'} ${isStreaming ? 'streaming' : ''}`}
      style={{ animationDelay: `${Math.min(index * 50, 300)}ms` }}
    >
      {!isUser && (
        <div className="message-avatar">
          <svg width="18" height="18" viewBox="0 0 40 40" fill="none">
            <path d="M20 6L34 14V26L20 34L6 26V14L20 6Z" fill="url(#msg-grad)" opacity="0.6" />
            <path d="M20 14L28 18V26L20 30L12 26V18L20 14Z" fill="url(#msg-grad)" />
            <defs>
              <linearGradient id="msg-grad" x1="6" y1="6" x2="34" y2="34">
                <stop stopColor="#a78bfa" />
                <stop offset="1" stopColor="#6d28d9" />
              </linearGradient>
            </defs>
          </svg>
        </div>
      )}
      <div className="message-content">
        <div
          className="message-text"
          dangerouslySetInnerHTML={{ __html: formatContent(message.content) }}
        />
        {isStreaming && <span className="cursor-blink">|</span>}
      </div>
    </div>
  );
};
