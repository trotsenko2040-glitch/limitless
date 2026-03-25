import React, { useState, useEffect } from 'react';
import { AuthPage } from './pages/AuthPage';
import { ChatPage } from './pages/ChatPage';
import { loadAuthToken, saveAuthToken, clearAuthToken } from './utils/storage';
import './styles/globals.css';

const App: React.FC = () => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isChecking, setIsChecking] = useState(true);

  useEffect(() => {
    const token = loadAuthToken();
    if (token) {
      setIsAuthenticated(true);
    }
    setIsChecking(false);
  }, []);

  const handleAuth = (token: string) => {
    saveAuthToken(token);
    setIsAuthenticated(true);
  };

  const handleLogout = () => {
    clearAuthToken();
    setIsAuthenticated(false);
  };

  if (isChecking) {
    return (
      <div style={{
        height: '100vh',
        width: '100vw',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#0a0a0f',
      }}>
        <div style={{
          width: 40,
          height: 40,
          border: '3px solid rgba(139, 92, 246, 0.2)',
          borderTopColor: '#8b5cf6',
          borderRadius: '50%',
          animation: 'spin 0.6s linear infinite',
        }} />
      </div>
    );
  }

  return isAuthenticated ? (
    <ChatPage onLogout={handleLogout} />
  ) : (
    <AuthPage onAuth={handleAuth} />
  );
};

export default App;
