import React from 'react';
import './LandingPage.css';

interface LandingPageProps {
  onOpenAuth: () => void;
  navActionLabel?: string;
  primaryActionLabel?: string;
}

export const LandingPage: React.FC<LandingPageProps> = ({
  onOpenAuth,
  navActionLabel = 'Войти',
  primaryActionLabel = 'Войти по токену',
}) => {
  const supportBotUrl = 'https://t.me/LimitlessSupport_bot';

  const scrollToSection = (sectionId: string) => {
    document.getElementById(sectionId)?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    });
  };

  const openSupportBot = () => {
    window.open(supportBotUrl, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="landing-page">
      <div className="bg-orb bg-orb-1" />
      <div className="bg-orb bg-orb-2" />
      <div className="bg-orb bg-orb-3" />

      <div className="landing-nav-shell">
        <nav className="landing-nav-capsule">
          <div className="landing-brand">
            <div className="landing-brand-icon">
              <svg width="22" height="22" viewBox="0 0 40 40" fill="none">
                <path d="M20 4L36 12V28L20 36L4 28V12L20 4Z" stroke="url(#landing-nav-grad)" strokeWidth="2" fill="none" />
                <path d="M20 14L28 18V26L20 30L12 26V18L20 14Z" fill="url(#landing-nav-grad)" opacity="0.35" />
                <defs>
                  <linearGradient id="landing-nav-grad" x1="4" y1="4" x2="36" y2="36">
                    <stop stopColor="#b9a3ff" />
                    <stop offset="1" stopColor="#6d28d9" />
                  </linearGradient>
                </defs>
              </svg>
            </div>
            <span>LIMITLESS</span>
          </div>

          <div className="landing-nav-links">
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
          <div className="landing-hero-badge">AI Mode</div>
          <h1 className="landing-title">Limitless — готовый ИИ-режим для быстрых и более прямых ответов</h1>
          <p className="landing-description">
            Limitless — это преднастроенный режим работы ИИ для тех, кто хочет получить более собранный стиль ответа
            без долгой ручной настройки. Купили доступ, активировали токен и сразу работаете в привычном интерфейсе.
          </p>

          <div className="landing-section-buttons">
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
                Limitless меняет подачу: ответы ощущаются более быстрыми, прямыми и цельными.
                Это не отдельная модель, а готовый режим работы поверх Gemini 3 Flash.
              </p>
            </article>

            <article className="landing-card">
              <h3>Один доступ без путаницы</h3>
              <p>
                После покупки у вас появляется один основной токен.
                Он закрепляется за вашим доступом и дальше только продлевается.
              </p>
            </article>

            <article className="landing-card">
              <h3>Запуск за пару минут</h3>
              <p>
                Не нужно собирать сложные настройки вручную:
                открываете сайт, вводите токен и продолжаете работать в уже готовом режиме.
              </p>
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
              <p>
                Если токен не пришел, не активируется или возник вопрос со входом,
                поддержка помогает быстро решить это без лишней переписки.
              </p>
            </article>

            <article className="landing-card">
              <h3>Продление и доступ</h3>
              <p>
                Через поддержку можно уточнить статус доступа, продление
                и любые вопросы, связанные с подпиской.
              </p>
            </article>

            <article className="landing-card">
              <h3>Связь в Telegram</h3>
              <p>
                Поддержка находится в Telegram, поэтому написать можно в любой момент
                и получить ответ там же, где вам удобно.
              </p>
            </article>
          </div>

          <div className="landing-support-note">
            Если у вас вопрос по оплате, токену или доступу к Limitless, просто напишите в Telegram-поддержку.
            <button type="button" className="landing-support-btn" onClick={openSupportBot}>
              Открыть помощь в Telegram
            </button>
          </div>
        </section>
      </main>
    </div>
  );
};
