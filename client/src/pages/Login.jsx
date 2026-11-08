import { useState } from 'react';
import { api } from '../api.js';
import Icon, { Logo } from '../icons.jsx';
import { Button, Field, InlineError } from '../components.jsx';

const FEATURES = [
  { icon: 'link', text: 'Connect banks with Plaid, or import CSV, OFX and QFX files.' },
  { icon: 'budgets', text: 'Budgets, cash flow, net worth and investments in one clean dashboard.' },
  { icon: 'assistant', text: 'Ask questions with the built-in AI assistant or connect Claude and Cursor over MCP.' },
  { icon: 'shield', text: 'Everything stays on your server. No analytics, no third parties.' },
];

export default function AuthScreen({ setup = false, onAuthed }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    if (setup && password !== confirm) {
      setError('Passwords do not match');
      return;
    }
    if (setup && password.length < 10) {
      setError('Choose a password with at least 10 characters');
      return;
    }
    setBusy(true);
    try {
      const payload = setup ? { name, email, password } : { email, password };
      const result = await api.post(setup ? '/auth/setup' : '/auth/login', payload);
      onAuthed(result.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-shell">
      <section className="auth-brand">
        <div className="brand">
          <Logo size={38} />
          <div>
            <div className="brand-name">Cove</div>
            <span className="brand-sub">Private personal finance</span>
          </div>
        </div>

        <div className="auth-copy">
          <h1>
            Your money.
            <br />
            Your server. <em>Your rules.</em>
          </h1>
          <p>
            A self-hosted finance dashboard that connects your accounts, categorizes every transaction,
            and turns the numbers into answers — without handing your data to anyone.
          </p>
          <div className="auth-features">
            {FEATURES.map((feature) => (
              <div className="auth-feature" key={feature.text}>
                <Icon name={feature.icon} size={16} />
                <span>{feature.text}</span>
              </div>
            ))}
          </div>
        </div>

        <p className="auth-foot">Runs on your hardware · SQLite storage · No telemetry</p>
      </section>

      <section className="auth-panel">
        <div className="auth-card">
          <h2>{setup ? 'Set up your Cove' : 'Welcome back'}</h2>
          <p>
            {setup
              ? 'Create the owner account. It stays local to this server and protects your financial data.'
              : 'Sign in to open your private finance dashboard.'}
          </p>

          <form className="auth-form" onSubmit={submit}>
            {setup ? (
              <Field label="Your name">
                <input
                  className="input"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Alex Morgan"
                  autoComplete="name"
                  autoFocus
                />
              </Field>
            ) : null}
            <Field label="Email">
              <input
                className="input"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                autoComplete="username"
                required
                autoFocus={!setup}
              />
            </Field>
            <Field label="Password" hint={setup ? 'At least 10 characters.' : undefined}>
              <input
                className="input"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={setup ? 'Choose a strong password' : 'Your password'}
                autoComplete={setup ? 'new-password' : 'current-password'}
                required
              />
            </Field>
            {setup ? (
              <Field label="Confirm password">
                <input
                  className="input"
                  type="password"
                  value={confirm}
                  onChange={(event) => setConfirm(event.target.value)}
                  placeholder="Repeat password"
                  autoComplete="new-password"
                  required
                />
              </Field>
            ) : null}

            <InlineError>{error}</InlineError>

            <Button type="submit" size="lg" className="btn-block" loading={busy}>
              {setup ? 'Create my Cove' : 'Sign in'}
            </Button>
          </form>

          <p className="auth-note">
            {setup
              ? 'You can change your email and password later in Settings. There is no password reset email — keep it somewhere safe.'
              : 'Sessions last 30 days. For extra protection, put Cove behind Cloudflare Access or a VPN.'}
          </p>
        </div>
      </section>
    </div>
  );
}
