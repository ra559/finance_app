import { useEffect, useState } from 'react';
import { api } from './api.js';
import Icon, { Logo } from './icons.jsx';
import { AppDataProvider, RouterProvider, ToastProvider, useApp, useRouter } from './state.jsx';
import { Spinner } from './components.jsx';
import { initials } from './format.js';
import AuthScreen from './pages/Login.jsx';
import OverviewPage from './pages/Overview.jsx';
import TransactionsPage from './pages/Transactions.jsx';
import BudgetsPage from './pages/Budgets.jsx';
import AccountsPage from './pages/Accounts.jsx';
import InvestmentsPage from './pages/Investments.jsx';
import RecurringPage from './pages/Recurring.jsx';
import ImportPage from './pages/Import.jsx';
import AssistantPage from './pages/Assistant.jsx';
import SettingsPage from './pages/Settings.jsx';

const NAV = [
  {
    label: 'Money',
    items: [
      { path: '/', label: 'Overview', icon: 'overview' },
      { path: '/transactions', label: 'Transactions', icon: 'transactions' },
      { path: '/budgets', label: 'Budgets', icon: 'budgets' },
    ],
  },
  {
    label: 'Wealth',
    items: [
      { path: '/accounts', label: 'Accounts', icon: 'accounts' },
      { path: '/investments', label: 'Investments', icon: 'investments' },
      { path: '/recurring', label: 'Recurring', icon: 'recurring' },
    ],
  },
  {
    label: 'Tools',
    items: [
      { path: '/import', label: 'Import', icon: 'import' },
      { path: '/assistant', label: 'Assistant', icon: 'assistant' },
      { path: '/settings', label: 'Settings', icon: 'settings' },
    ],
  },
];

function Shell() {
  const { path, navigate } = useRouter();
  const { user, onLogout } = useApp();

  const page = (() => {
    switch (path) {
      case '/transactions':
        return <TransactionsPage />;
      case '/budgets':
        return <BudgetsPage />;
      case '/accounts':
        return <AccountsPage />;
      case '/investments':
        return <InvestmentsPage />;
      case '/recurring':
        return <RecurringPage />;
      case '/import':
        return <ImportPage />;
      case '/assistant':
        return <AssistantPage />;
      case '/settings':
        return <SettingsPage />;
      default:
        return <OverviewPage />;
    }
  })();

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button type="button" className="brand" onClick={() => navigate('/')} style={{ border: 0, background: 'none', cursor: 'pointer' }}>
          <Logo />
          <div>
            <div className="brand-name">Cove</div>
            <span className="brand-sub">Private finance</span>
          </div>
        </button>

        <nav className="nav">
          {NAV.map((group) => (
            <div key={group.label} style={{ display: 'contents' }}>
              <div className="nav-group-label">{group.label}</div>
              {group.items.map((item) => (
                <button
                  key={item.path}
                  type="button"
                  className={`nav-item ${path === item.path ? 'active' : ''}`}
                  onClick={() => navigate(item.path)}
                  aria-current={path === item.path ? 'page' : undefined}
                >
                  <Icon name={item.icon} size={17} />
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-foot">
          <button type="button" className="assistant-cta" onClick={() => navigate('/assistant')}>
            <Icon name="assistant" size={18} />
            <div>
              <strong>Ask Cove</strong>
              <span>Questions about your money</span>
            </div>
          </button>
          <div className="user-row">
            <span className="avatar">{initials(user?.name, user?.email)}</span>
            <div className="user-meta">
              <strong>{user?.name || 'You'}</strong>
              <span>{user?.email}</span>
            </div>
            <button type="button" className="icon-btn" onClick={onLogout} aria-label="Sign out" title="Sign out">
              <Icon name="logout" size={16} />
            </button>
          </div>
        </div>
      </aside>

      <main className="main">{page}</main>
    </div>
  );
}

export default function App() {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .get('/auth/status')
      .then(setStatus)
      .catch((err) => setError(err.message));
  }, []);

  const onAuthed = (user) => setStatus({ setupRequired: false, authenticated: true, user });

  const onLogout = async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      setStatus({ setupRequired: false, authenticated: false, user: null });
    }
  };

  return (
    <RouterProvider>
      <ToastProvider>
        {!status ? (
          <div className="splash">
            <div className="splash-inner">
              <Logo size={44} />
              <Spinner size="lg" />
              {error ? <span>{error}</span> : <span>Opening Cove…</span>}
            </div>
          </div>
        ) : status.setupRequired ? (
          <AuthScreen setup onAuthed={onAuthed} />
        ) : !status.authenticated ? (
          <AuthScreen onAuthed={onAuthed} />
        ) : (
          <AppDataProvider user={status.user} onLogout={onLogout}>
            <Shell />
          </AppDataProvider>
        )}
      </ToastProvider>
    </RouterProvider>
  );
}
