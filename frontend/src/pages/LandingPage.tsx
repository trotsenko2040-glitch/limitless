import React, { useState } from 'react';
import { getApiUrl } from '../utils/api';
import { saveAdminAuthToken } from '../utils/storage';
import './LandingPage.css';

interface LandingPageProps {
  onOpenAuth: () => void;
  onOpenAdmin?: () => void;
  navActionLabel?: string;
  primaryActionLabel?: string;
}

export const LandingPage: React.FC<LandingPageProps> = ({
  onOpenAuth,
  onOpenAdmin,
  navActionLabel = 'Войти',
  primaryActionLabel = 'Войти по токену',
}) => {
  const supportBotUrl = 'https://t.me/LimitlessSupport_bot';
  const agreementUrl = '/terms';
  const [terminalPassword, setTerminalPassword] = useState('');
  const [terminalMessage, setTerminalMessage] = useState('');
  const [terminalMessageType, setTerminalMessageType] = useState<'idle' | 'error' | 'success'>('idle');
  const [isUnlocking, setIsUnlocking] = useState(false);

  const terminalLines = [
    { kind: 'muted', text: 'limitless@node:~$ status' },
    { kind: 'success', text: 'prompt profile: limitless-1.5' },
    { kind: 'success', text: 'model route: gemini-3-flash' },
    { kind: 'muted', text: 'limitless@node:~$ runtime --check cache' },
    { kind: 'success', text: 'cache synced successfully' },
    { kind: 'muted', text: 'limitless@node:~$ support --open telegram' },
    { kind: 'accent', text: 'channel: @LimitlessSupport_bot' },
  ];

  const scrollToSection = (sectionId: string) => {
    document.getElementById(sectionId)?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    });
  };

  const openSupportBot = () => {
    window.open(supportBotUrl, '_blank', 'noopener,noreferrer');
  };

  const openAgreement = () => {
    window.location.href = agreementUrl;
  };

  const handleTerminalLogin = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!terminalPassword.trim()) {
      setTerminalMessage('command required.');
      setTerminalMessageType('error');
      return;
    }

    setIsUnlocking(true);
    setTerminalMessage('');
    setTerminalMessageType('idle');

    try {
      const response = await fetch(getApiUrl('/api/admin/login'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username: 'admin',
          password: terminalPassword.trim(),
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.token) {
        throw new Error('Access denied');
      }

      saveAdminAuthToken(data.token);
      setTerminalPassword('');
      setTerminalMessage('session accepted.');
      setTerminalMessageType('success');
      onOpenAdmin?.();
    } catch {
      setTerminalMessage('command rejected.');
      setTerminalMessageType('error');
    } finally {
      setIsUnlocking(false);
    }
  };

  return (
    <div className="landing-page">
      <div className="bg-orb bg-orb-1" />
      <div className="bg-orb bg-orb-2" />
      <div className="bg-orb bg-orb-3" />

      <div className="landing-nav-shell">
        <nav className="landing-nav-capsule">
          <div className="landing-brand">
            <img className="landing-brand-icon" src="/limitless-icon.svg" alt="Limitless icon" />
            <span className="landing-brand-text">LIMITLESS</span>
          </div>

          <div className="landing-nav-links">
            <button type="button" className="landing-nav-link" onClick={openAgreement} title="Пользовательское соглашение">
              Соглашение
            </button>
            <button type="button" className="landing-nav-link" onClick={() => scrollToSection('home')}>
              Главная
            </button>
            <button type="button" className="landing-nav-link" onClick={() => scrollToSection('about')}>
              О нас
            </button>
            <button type="button" className="landing-nav-link" onClick={openSupportBot}>
              Поддержка
            </button>
          </div>

          <button type="button" className="landing-login-btn" onClick={onOpenAuth}>
            {navActionLabel}
          </button>
        </nav>
      </div>

      <main className="landing-content">
        <section id="home" className="landing-hero">
          <div className="landing-hero-grid">
            <div className="landing-hero-copy">
              <div className="landing-hero-badge">AI Mode</div>
              <h1 className="landing-title">Limitless - готовый ИИ-режим для быстрых и более прямых ответов</h1>
              <p className="landing-description">
                Limitless - это преднастроенный режим работы ИИ для тех, кто хочет получить более собранный стиль ответа без долгой ручной
                настройки. Купили доступ, активировали токен и сразу работаете в привычном интерфейсе.
              </p>

              <div className="landing-section-buttons">
                <button type="button" className="landing-pill-btn" onClick={openAgreement}>
                  Соглашение
                </button>
                <button type="button" className="landing-pill-btn" onClick={() => scrollToSection('home')}>
                  Главная
                </button>
                <button type="button" className="landing-pill-btn" onClick={() => scrollToSection('about')}>
                  О нас
                </button>
                <button type="button" className="landing-pill-btn" onClick={openSupportBot}>
                  Поддержка
                </button>
              </div>

              <div className="landing-cta-row">
                <button type="button" className="landing-primary-btn" onClick={onOpenAuth}>
                  {primaryActionLabel}
                </button>
                <a
                  className="landing-secondary-btn"
                  href="https://t.me/LimitlesspromtShop_bot"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Купить доступ в Telegram
                </a>
              </div>
            </div>

            <div className="landing-terminal-shell" aria-label="Limitless terminal access">
              <div className="landing-terminal-window">
                <div className="landing-terminal-toolbar">
                  <div className="landing-terminal-dots">
                    <span className="landing-terminal-dot terminal-dot-red" />
                    <span className="landing-terminal-dot terminal-dot-yellow" />
                    <span className="landing-terminal-dot terminal-dot-green" />
                  </div>
                  <span className="landing-terminal-title">limitless@node: /runtime/console</span>
                  <span className="landing-terminal-chip">live session</span>
                </div>

                <div className="landing-terminal-body">
                  <div className="landing-terminal-prompt">
                    <span className="landing-terminal-user">limitless@node</span>
                    <span className="landing-terminal-separator">:</span>
                    <span className="landing-terminal-path">~/access</span>
                    <span className="landing-terminal-symbol">$</span>
                    <span className="landing-terminal-command">boot --profile limitless</span>
                  </div>

                  <div className="landing-terminal-output">
                    {terminalLines.map((line, index) => (
                      <div
                        key={`${line.text}-${index}`}
                        className={`landing-terminal-line landing-terminal-line-${line.kind}`}
                        style={{ animationDelay: `${0.18 + index * 0.08}s` }}
                      >
                        {line.text}
                      </div>
                    ))}
                  </div>

                  <form className="landing-terminal-form" onSubmit={handleTerminalLogin}>
                    <label className="landing-terminal-input-row" htmlFor="landing-terminal-password">
                      <span className="landing-terminal-input-prefix">
                        <span className="landing-terminal-user">limitless@node</span>
                        <span className="landing-terminal-separator">:</span>
                        <span className="landing-terminal-path">~/session</span>
                        <span className="landing-terminal-symbol">$</span>
                      </span>
                      <input
                        id="landing-terminal-password"
                        className="landing-terminal-input"
                        type="password"
                        value={terminalPassword}
                        onChange={(e) => setTerminalPassword(e.target.value)}
                        placeholder="type command..."
                        autoComplete="off"
                        spellCheck={false}
                        aria-label="Terminal input"
                      />
                    </label>

                    <div className="landing-terminal-actions" aria-live="polite">
                      {isUnlocking ? (
                        <span className="landing-terminal-feedback">processing...</span>
                      ) : (
                        terminalMessage && (
                          <span className={`landing-terminal-feedback landing-terminal-feedback-${terminalMessageType}`}>
                            {terminalMessage}
                          </span>
                        )
                      )}
                    </div>
                  </form>

                  <div className="landing-terminal-footer">
                    <span className="landing-terminal-status">node synced</span>
                    <span className="landing-terminal-cursor" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="about" className="landing-section">
          <div className="landing-section-heading">
            <span className="landing-section-kicker">О нас</span>
            <h2>Что такое Limitless и как устроен доступ</h2>
          </div>

          <div className="landing-grid">
            <article className="landing-card">
              <h3>Другой стиль ответов</h3>
              <p>
                Limitless меняет подачу: ответы ощущаются более быстрыми, прямыми и цельными. Это не отдельная модель, а готовый режим
                работы поверх Gemini 3 Flash.
              </p>
            </article>

            <article className="landing-card">
              <h3>Один доступ без путаницы</h3>
              <p>После покупки у вас появляется один основной токен. Он закрепляется за вашим доступом и дальше только продлевается.</p>
            </article>

            <article className="landing-card">
              <h3>Запуск за пару минут</h3>
              <p>Не нужно собирать сложные настройки вручную: открываете сайт, вводите токен и работаете в уже готовом режиме.</p>
            </article>
          </div>
        </section>

        <section id="support" className="landing-section">
          <div className="landing-section-heading">
            <span className="landing-section-kicker">Поддержка</span>
            <h2>Поддержка по доступу, оплате и запуску</h2>
          </div>

          <div className="landing-grid">
            <article className="landing-card">
              <h3>Помощь с активацией</h3>
              <p>Если токен не пришел, не активируется или возник вопрос со входом, поддержка помогает быстро решить это без лишней переписки.</p>
            </article>

            <article className="landing-card">
              <h3>Продление и доступ</h3>
              <p>Через поддержку можно уточнить статус доступа, продление и любые вопросы, связанные с подпиской.</p>
            </article>

            <article className="landing-card">
              <h3>Связь в Telegram</h3>
              <p>Поддержка находится в Telegram, поэтому написать можно в любой момент и получить ответ там же, где вам удобно.</p>
            </article>
          </div>

          <div className="landing-support-note">
            Если у вас вопрос по оплате, токену или доступу к Limitless, просто напишите в Telegram-поддержку.
            <button type="button" className="landing-support-btn" onClick={openSupportBot}>
              Открыть помощь в Telegram
            </button>
          </div>
        </section>

        <footer className="landing-footer">
          <span className="landing-footer-copy">© 2026 Limitless</span>
          <div className="landing-footer-links">
            <a href="/terms" className="landing-footer-link">
              Пользовательское соглашение
            </a>
            <a href={supportBotUrl} className="landing-footer-link" target="_blank" rel="noopener noreferrer">
              Поддержка
            </a>
          </div>
        </footer>
      </main>
    </div>
  );
};
