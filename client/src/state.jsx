import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from './api.js';

const AppCtx = createContext(null);
const RouterCtx = createContext(null);
const ToastCtx = createContext(null);

export function RouterProvider({ children }) {
  const [path, setPath] = useState(window.location.pathname);

  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = useCallback((to) => {
    if (to === window.location.pathname) return;
    window.history.pushState({}, '', to);
    setPath(to);
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, []);

  const value = useMemo(() => ({ path, navigate }), [path, navigate]);
  return <RouterCtx.Provider value={value}>{children}</RouterCtx.Provider>;
}

export const useRouter = () => useContext(RouterCtx);

export function AppDataProvider({ user, onLogout, children }) {
  const [settings, setSettings] = useState(null);
  const [prefs, setPrefs] = useState({ currency: 'USD', locale: 'en-US' });

  const refreshSettings = useCallback(async () => {
    try {
      const data = await api.get('/settings');
      setSettings(data);
      setPrefs(data.preferences || { currency: 'USD', locale: 'en-US' });
      return data;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    refreshSettings();
  }, [refreshSettings]);

  const value = useMemo(
    () => ({ user, onLogout, settings, setSettings, prefs, setPrefs, refreshSettings }),
    [user, onLogout, settings, prefs, refreshSettings],
  );

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

export const useApp = () => useContext(AppCtx);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const push = useCallback((message, tone = 'info') => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((current) => [...current, { id, message, tone }]);
    setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 4800);
  }, []);

  const value = useMemo(() => push, [push]);

  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast-${toast.tone}`}>
            <span>{toast.message}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);
