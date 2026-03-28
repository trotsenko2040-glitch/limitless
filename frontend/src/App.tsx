import React, { useEffect, useState } from 'react';
import { GlobalStarfield } from './components/GlobalStarfield';
import { AdminPage } from './pages/AdminPage';
import { ChatPage } from './pages/ChatPage';
import { AuthPage } from './pages/AuthPage';
import { LandingPage } from './pages/LandingPage';
import { ProfilePage } from './pages/ProfilePage';
import { UserAgreementPage } from './pages/UserAgreementPage';
import { resolveAuthError } from './utils/authErrors';
import { fetchApi } from './utils/api';
import {
  clearAuthToken,
  loadAuthToken,
  loadOrCreateDeviceId,
  loadProfile,
  migrateAccountStorage,
  saveAuthToken,
} from './utils/storage';
import './styles/globals.css';

function shouldKeepDeviceLocked(error?: string): boolean {
  switch (error) {
    case 'DEVICE_ALREADY_BOUND':
    case 'TOKEN_ALREADY_BOUND':
    case 'SUBSCRIPTION_EXPIRED':
    case 'SUBSCRIPTION_INACTIVE':
    case 'TOKEN_REVOKED':
      return true;
    default:
      return false;
  }
}

const App: React.FC = () => {
  const [pathname, setPathname] = useState(() => window.location.pathname);
  const isSecretConsoleRoute = pathname.startsWith('/sys/tty');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isChecking, setIsChecking] = useState(true);
  const [isBoundToToken, setIsBoundToToken] = useState(false);
  const [authError, setAuthError] = useState('');
  const [showAuthPage, setShowAuthPage] = useState(false);
  const [showLandingWhileAuthenticated, setShowLandingWhileAuthenticated] = useState(false);
  const isAdminRoute = pathname.startsWith('/admin') || isSecretConsoleRoute;
  const isAgreementRoute = pathname.startsWith('/terms');
  const isProfileRoute = pathname.startsWith('/profile');

  useEffect(() => {
    const handlePopState = () => setPathname(window.location.pathname);
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    if (isAdminRoute || isAgreementRoute) {
      setIsChecking(false);
      return;
    }

    const token = loadAuthToken();

    if (!token) {
      setIsBoundToToken(false);
      setShowAuthPage(false);
      setShowLandingWhileAuthenticated(false);
      setIsChecking(false);
      return;
    }

    const deviceId = loadOrCreateDeviceId();
    let isCancelled = false;

    const validateStoredToken = async () => {
      try {
        const response = await fetchApi('/api/validate', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ token, deviceId }),
        });

        if (!response.ok) {
          throw new Error('Stored token validation failed');
        }

        const data = await response.json();

        if (isCancelled) {
          return;
        }

        if (data.valid) {
          if (data.token && data.token !== token) {
            migrateAccountStorage(token, data.token);
            saveAuthToken(data.token);
          }
          setAuthError('');
          setIsBoundToToken(true);
          setShowAuthPage(false);
          setIsAuthenticated(true);
        } else {
          const shouldLock = shouldKeepDeviceLocked(data.error);

          if (!shouldLock) {
            clearAuthToken();
          }

          setAuthError(shouldLock ? resolveAuthError(data.error) : '');
          setIsBoundToToken(shouldLock);
          setShowAuthPage(shouldLock);
          setShowLandingWhileAuthenticated(false);
          setIsAuthenticated(false);
        }
      } catch {
        if (!isCancelled) {
          setAuthError('');
          setIsBoundToToken(false);
          setShowAuthPage(false);
          setShowLandingWhileAuthenticated(false);
          setIsAuthenticated(false);
        }
      } finally {
        if (!isCancelled) {
          setIsChecking(false);
        }
      }
    };

    validateStoredToken();

    return () => {
      isCancelled = true;
    };
  }, [isAdminRoute, isAgreementRoute]);

  const navigate = (nextPath: string) => {
    if (window.location.pathname !== nextPath) {
      window.history.pushState({}, '', nextPath);
    }
    setPathname(nextPath);
  };

  const handleAuth = (token: string) => {
    const previousToken = loadAuthToken();
    if (previousToken && previousToken !== token) {
      migrateAccountStorage(previousToken, token);
    }
    saveAuthToken(token);
    setIsBoundToToken(true);
    setAuthError('');
    setShowAuthPage(false);
    setShowLandingWhileAuthenticated(false);
    setIsAuthenticated(true);
  };

  const handleGoHome = () => {
    setShowLandingWhileAuthenticated(true);
  };

  const handleOpenFromLanding = () => {
    if (isAuthenticated) {
      setShowLandingWhileAuthenticated(false);
      return;
    }

    setShowAuthPage(true);
  };

  const handleOpenAdminFromLanding = () => {
    navigate('/admin');
  };

  const handleOpenProfile = () => {
    navigate('/profile');
  };

  const handleOpenChat = () => {
    setShowLandingWhileAuthenticated(false);
    navigate('/');
  };

  const renderScene = (content: React.ReactNode) => (
    <>
      <GlobalStarfield />
      <div className="app-shell">{content}</div>
    </>
  );

  if (isAdminRoute) {
    return renderScene(<AdminPage onBackHome={() => navigate('/')} secretMode={isSecretConsoleRoute} />);
  }

  if (isAgreementRoute) {
    return renderScene(<UserAgreementPage onBackHome={() => navigate('/')} />);
  }

  if (isChecking) {
    return renderScene(
      <div
        style={{
          height: '100dvh',
          width: '100vw',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0a0a0f',
        }}
      >
        <div
          style={{
            width: 40,
            height: 40,
            border: '3px solid rgba(139, 92, 246, 0.2)',
            borderTopColor: '#8b5cf6',
            borderRadius: '50%',
            animation: 'spin 0.6s linear infinite',
          }}
        />
      </div>,
    );
  }

  if (isAuthenticated && isProfileRoute) {
    return renderScene(
      <ProfilePage
        onBackHome={() => navigate('/')}
        onOpenChat={handleOpenChat}
      />,
    );
  }

  if (isAuthenticated && !showLandingWhileAuthenticated) {
    return renderScene(<ChatPage onGoHome={handleGoHome} />);
  }

  if (showLandingWhileAuthenticated) {
    return renderScene(
      <LandingPage
        onOpenAuth={handleOpenFromLanding}
        onOpenAdmin={handleOpenAdminFromLanding}
        onOpenProfile={handleOpenProfile}
        primaryActionLabel="Войти в чат"
        isAuthenticated
        profile={loadProfile()}
      />,
    );
  }

  if (isBoundToToken || showAuthPage) {
    return renderScene(
      <AuthPage
        onAuth={handleAuth}
        locked={isBoundToToken}
        lockedMessage={authError}
        onRetryLockedToken={isBoundToToken ? () => window.location.reload() : undefined}
        onBack={!isBoundToToken ? () => setShowAuthPage(false) : undefined}
      />,
    );
  }

  return renderScene(
    <LandingPage onOpenAuth={handleOpenFromLanding} onOpenAdmin={handleOpenAdminFromLanding} onOpenProfile={handleOpenProfile} />,
  );
};

export default App;
