import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import Icon from '../icons.jsx';
import {
  Badge,
  Button,
  Card,
  CopyButton,
  Field,
  InlineError,
  Loading,
  PageHeader,
  Tabs,
} from '../components.jsx';
import { useApp, useRouter, useToast } from '../state.jsx';
import { formatDate } from '../format.js';

const SECTIONS = [
  { value: 'profile', label: 'Profile & security' },
  { value: 'assistant', label: 'AI assistant' },
  { value: 'connections', label: 'Connections & MCP' },
  { value: 'categories', label: 'Categories' },
  { value: 'data', label: 'Data & preferences' },
];

const KIND_COLORS = { expense: 'var(--text-2)', income: 'var(--accent)', transfer: 'var(--info)' };

export default function SettingsPage() {
  const [settings, setSettings] = useState(null);
  const [section, setSection] = useState('profile');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const { refreshSettings } = useApp();
  const { navigate } = useRouter();
  const toast = useToast();

  const [profile, setProfile] = useState({ name: '', email: '' });
  const [password, setPassword] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [ai, setAi] = useState({ baseUrl: '', model: '', apiKey: '', clearKey: false });
  const [testing, setTesting] = useState(false);
  const [tokenName, setTokenName] = useState('');
  const [newToken, setNewToken] = useState('');
  const [categories, setCategories] = useState([]);
  const [newCategory, setNewCategory] = useState({ name: '', kind: 'expense', color: '#3ddc97' });
  const [currency, setCurrency] = useState('USD');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [result, categoryResult] = await Promise.all([api.get('/settings'), api.get('/categories')]);
      setSettings(result);
      setProfile({ name: result.profile.name || '', email: result.profile.email });
      setAi({
        baseUrl: result.ai.baseUrl,
        model: result.ai.model,
        apiKey: '',
        clearKey: false,
      });
      setCurrency(result.preferences.currency);
      setCategories(categoryResult.categories);
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const saveProfile = async () => {
    setBusy(true);
    try {
      await api.patch('/settings/profile', profile);
      toast('Profile updated', 'success');
      await refreshSettings();
      await load();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const changePassword = async () => {
    if (password.newPassword !== password.confirm) {
      toast('New passwords do not match', 'error');
      return;
    }
    setBusy(true);
    try {
      await api.post('/auth/password', {
        currentPassword: password.currentPassword,
        newPassword: password.newPassword,
      });
      setPassword({ currentPassword: '', newPassword: '', confirm: '' });
      toast('Password changed — other sessions signed out', 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const saveAi = async () => {
    setBusy(true);
    try {
      const result = await api.put('/settings/ai', {
        baseUrl: ai.baseUrl,
        model: ai.model,
        apiKey: ai.apiKey || undefined,
        clearKey: ai.clearKey,
      });
      setSettings((current) => ({ ...current, ai: result.ai }));
      setAi((current) => ({ ...current, apiKey: '', clearKey: false }));
      toast('Assistant settings saved', 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const testAi = async () => {
    setTesting(true);
    try {
      const result = await api.post('/settings/ai/test');
      toast(`Provider responded: ${result.reply || 'ready'}`, 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setTesting(false);
    }
  };

  const createToken = async () => {
    setBusy(true);
    try {
      const result = await api.post('/settings/mcp-tokens', { name: tokenName || 'MCP client' });
      setNewToken(result.token);
      setTokenName('');
      setSettings((current) => ({ ...current, mcp: { ...current.mcp, tokens: result.tokens } }));
      toast('MCP token created — copy it now', 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const revokeToken = async (token) => {
    if (!window.confirm(`Revoke “${token.name}”? Clients using it will lose access.`)) return;
    try {
      const result = await api.del(`/settings/mcp-tokens/${token.id}`);
      setSettings((current) => ({ ...current, mcp: { ...current.mcp, tokens: result.tokens } }));
      toast('Token revoked', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const addCategory = async () => {
    setBusy(true);
    try {
      await api.post('/categories', newCategory);
      setNewCategory({ name: '', kind: 'expense', color: '#3ddc97' });
      toast('Category added', 'success');
      await load();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const deleteCategory = async (category) => {
    if (!window.confirm(`Delete “${category.name}”? Transactions will become uncategorized.`)) return;
    try {
      await api.del(`/categories/${category.id}`);
      toast('Category deleted', 'success');
      await load();
    } catch (err) {
      if (err.message.includes('budget')) {
        if (window.confirm('This category has a budget. Delete it anyway?')) {
          try {
            await api.del(`/categories/${category.id}?force=1`);
            toast('Category deleted', 'success');
            await load();
          } catch (inner) {
            toast(inner.message, 'error');
          }
        }
      } else {
        toast(err.message, 'error');
      }
    }
  };

  const saveCurrency = async () => {
    setBusy(true);
    try {
      const result = await api.put('/settings/preferences', { currency });
      setSettings((current) => ({ ...current, preferences: result.preferences }));
      await refreshSettings();
      toast('Currency updated', 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const loadDemo = async () => {
    setBusy(true);
    try {
      await api.post('/settings/demo');
      toast('Demo data loaded', 'success');
      await load();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const clearDemo = async () => {
    if (!window.confirm('Remove all demo accounts and transactions? Your real data is untouched.')) return;
    setBusy(true);
    try {
      await api.del('/settings/demo');
      toast('Demo data removed', 'success');
      await load();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const clearChat = async () => {
    if (!window.confirm('Clear the assistant conversation history?')) return;
    try {
      await api.del('/chat');
      toast('Chat history cleared', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const mcpSnippet = useMemo(() => {
    const endpoint = settings?.mcp?.endpoint || 'https://finance.example.com/api/mcp';
    return JSON.stringify(
      {
        mcpServers: {
          cove: {
            type: 'http',
            url: endpoint,
            headers: { Authorization: `Bearer ${newToken || 'YOUR_TOKEN'}` },
          },
        },
      },
      null,
      2,
    );
  }, [settings, newToken]);

  const curSnippet = useMemo(() => {
    const endpoint = settings?.mcp?.endpoint || 'https://finance.example.com/api/mcp';
    return `curl -s ${endpoint} \\\n  -H "Authorization: Bearer YOUR_TOKEN" \\\n  -H "Content-Type: application/json" \\\n  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`;
  }, [settings]);

  if (loading && !settings) {
    return (
      <>
        <PageHeader title="Settings" subtitle="Your account, integrations and data." />
        <Loading rows={4} height={90} />
      </>
    );
  }

  return (
    <>
      <PageHeader title="Settings" subtitle="Your account, integrations and data.">
        <span className="chip">
          <Icon name="shield" size={13} /> Self-hosted
        </span>
      </PageHeader>
      {error ? <InlineError>{error}</InlineError> : null}

      <div className="settings-grid">
        <nav className="settings-nav">
          {SECTIONS.map((item) => (
            <button
              key={item.value}
              type="button"
              className={section === item.value ? 'active' : ''}
              onClick={() => setSection(item.value)}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div className="settings-section">
          {section === 'profile' ? (
            <>
              <div className="settings-section-head">
                <h2>Profile & security</h2>
                <p>The owner account for this Cove instance. There is no email reset, so keep these credentials safe.</p>
              </div>
              <Card title="Your account">
                <div className="form-grid">
                  <Field label="Name">
                    <input
                      className="input"
                      value={profile.name}
                      onChange={(event) => setProfile({ ...profile, name: event.target.value })}
                    />
                  </Field>
                  <Field label="Email">
                    <input
                      className="input"
                      type="email"
                      value={profile.email}
                      onChange={(event) => setProfile({ ...profile, email: event.target.value })}
                    />
                  </Field>
                </div>
                <div className="form-actions">
                  <Button onClick={saveProfile} loading={busy}>
                    Save profile
                  </Button>
                </div>
              </Card>

              <Card title="Change password" subtitle="Changing it signs out every other session">
                <div className="form-grid">
                  <Field label="Current password" className="full">
                    <input
                      className="input"
                      type="password"
                      value={password.currentPassword}
                      onChange={(event) => setPassword({ ...password, currentPassword: event.target.value })}
                      autoComplete="current-password"
                    />
                  </Field>
                  <Field label="New password">
                    <input
                      className="input"
                      type="password"
                      value={password.newPassword}
                      onChange={(event) => setPassword({ ...password, newPassword: event.target.value })}
                      autoComplete="new-password"
                    />
                  </Field>
                  <Field label="Confirm new password">
                    <input
                      className="input"
                      type="password"
                      value={password.confirm}
                      onChange={(event) => setPassword({ ...password, confirm: event.target.value })}
                      autoComplete="new-password"
                    />
                  </Field>
                </div>
                <div className="form-actions">
                  <Button
                    variant="ghost"
                    onClick={changePassword}
                    loading={busy}
                    disabled={!password.currentPassword || password.newPassword.length < 10}
                  >
                    Update password
                  </Button>
                </div>
              </Card>

              <div className="notice">
                <Icon name="shield" size={16} />
                <span>
                  For internet-facing installs, put Cove behind Cloudflare Access or a VPN as well as this login. The README
                  walks through the setup.
                </span>
              </div>
            </>
          ) : null}

          {section === 'assistant' ? (
            <>
              <div className="settings-section-head">
                <h2>AI assistant</h2>
                <p>
                  Use any OpenAI-compatible <span className="mono">/chat/completions</span> endpoint. The assistant can only
                  read data through tool calls — it cannot move money or edit transactions.
                </p>
              </div>

              <Card
                title="Provider"
                subtitle={settings.ai.configured ? 'Configured' : 'Not configured yet'}
                actions={<Badge color={settings.ai.configured ? 'var(--accent)' : 'var(--warning)'}>{settings.ai.configured ? 'Ready' : 'Setup needed'}</Badge>}
              >
                <div className="form-grid">
                  <Field label="Base URL" className="full" hint="Examples: https://api.openai.com/v1 · http://host.docker.internal:11434/v1 · https://openrouter.ai/api/v1">
                    <input
                      className="input"
                      value={ai.baseUrl}
                      onChange={(event) => setAi({ ...ai, baseUrl: event.target.value })}
                      placeholder="https://api.openai.com/v1"
                    />
                  </Field>
                  <Field label="Model">
                    <input
                      className="input"
                      value={ai.model}
                      onChange={(event) => setAi({ ...ai, model: event.target.value })}
                      placeholder="gpt-4.1-mini"
                    />
                  </Field>
                  <Field label="API key" hint={settings.ai.hasKey ? `Saved: ${settings.ai.maskedKey}` : 'Not needed for Ollama or LM Studio'}>
                    <input
                      className="input"
                      type="password"
                      value={ai.apiKey}
                      onChange={(event) => setAi({ ...ai, apiKey: event.target.value })}
                      placeholder={settings.ai.hasKey ? 'Leave blank to keep the saved key' : 'sk-…'}
                      autoComplete="off"
                    />
                  </Field>
                  {settings.ai.hasKey ? (
                    <label className="checkbox full">
                      <input
                        type="checkbox"
                        checked={ai.clearKey}
                        onChange={(event) => setAi({ ...ai, clearKey: event.target.checked })}
                      />
                      <span>Remove the stored API key</span>
                    </label>
                  ) : null}
                </div>

                {Object.values(settings.ai.envOverrides || {}).some(Boolean) ? (
                  <div className="notice" style={{ marginTop: 14 }}>
                    <Icon name="alert" size={16} />
                    <span>Some values come from environment variables and override what you save here.</span>
                  </div>
                ) : null}

                <div className="form-actions">
                  <Button variant="ghost" onClick={testAi} loading={testing} disabled={!settings.ai.configured}>
                    Test connection
                  </Button>
                  <Button onClick={saveAi} loading={busy}>
                    Save assistant settings
                  </Button>
                </div>
              </Card>

              <Card title="Suggested providers">
                <div className="stack-sm">
                  <div className="kv">
                    <span>Fully local (private)</span>
                    <strong>Ollama · http://host.docker.internal:11434/v1 · llama3.1</strong>
                  </div>
                  <div className="kv">
                    <span>Cloud API</span>
                    <strong>OpenAI · gpt-4.1-mini · needs an API key</strong>
                  </div>
                  <div className="kv">
                    <span>Cloud router</span>
                    <strong>OpenRouter · anthropic/claude-sonnet-4</strong>
                  </div>
                </div>
                <p className="field-hint" style={{ marginTop: 12 }}>
                  When you ask a question, your prompt and the tool results needed to answer it are sent to the provider you
                  configure. Choose a local model if you want the assistant to stay entirely offline.
                </p>
              </Card>
            </>
          ) : null}

          {section === 'connections' ? (
            <>
              <div className="settings-section-head">
                <h2>Connections & MCP</h2>
                <p>
                  Link banks for automatic sync, and issue tokens so Claude, Cursor or any MCP client can query your
                  finances. Tokens are read-only and can be revoked at any time.
                </p>
              </div>

              <Card title="Bank sync (Plaid)" actions={<Badge color={settings.plaid.configured ? 'var(--accent)' : 'var(--warning)'}>{settings.plaid.configured ? settings.plaid.environment : 'Not configured'}</Badge>}>
                <div className="stack-sm">
                  <div className="kv">
                    <span>Status</span>
                    <strong>{settings.plaid.configured ? 'Keys detected' : 'Add PLAID_CLIENT_ID and PLAID_SECRET'}</strong>
                  </div>
                  <div className="kv">
                    <span>Linked banks</span>
                    <strong>{settings.plaid.items?.length || 0}</strong>
                  </div>
                  <div className="kv">
                    <span>Investments</span>
                    <strong>{settings.plaid.investments ? 'Enabled' : 'Disabled'}</strong>
                  </div>
                  <div className="form-actions" style={{ marginTop: 6 }}>
                    <Button variant="ghost" icon="bank" onClick={() => navigate('/accounts')}>
                      Manage bank connections
                    </Button>
                  </div>
                </div>
              </Card>

              <Card
                title="MCP tokens"
                subtitle="For Claude Desktop, Claude Code, Cursor or custom agents"
                actions={
                  <div className="form-row">
                    <input
                      className="input input-sm"
                      value={tokenName}
                      onChange={(event) => setTokenName(event.target.value)}
                      placeholder="Token name"
                      style={{ width: 150 }}
                    />
                    <Button size="sm" icon="plus" onClick={createToken} loading={busy}>
                      Create
                    </Button>
                  </div>
                }
              >
                {newToken ? (
                  <div className="token-reveal">
                    <div className="token-reveal-head">
                      <strong>Copy this token now</strong>
                      <CopyButton value={newToken} onCopied={(message) => toast(message, 'success')} />
                    </div>
                    <code className="code-block">{newToken}</code>
                    <p>It cannot be shown again. Paste it into your MCP client configuration.</p>
                  </div>
                ) : null}

                {settings.mcp.tokens.length ? (
                  <div className="stack-sm">
                    {settings.mcp.tokens.map((token) => (
                      <div className="token-row" key={token.id}>
                        <span className="account-type-icon">
                          <Icon name="key" size={15} />
                        </span>
                        <div className="token-main">
                          <div className="token-name">{token.name}</div>
                          <div className="token-meta">
                            {token.prefix}… · created {formatDate(token.created_at.slice(0, 10))}
                            {token.last_used_at ? ` · used ${formatDate(token.last_used_at.slice(0, 10))}` : ' · never used'}
                          </div>
                        </div>
                        <Button size="sm" variant="danger" onClick={() => revokeToken(token)}>
                          Revoke
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="field-hint">No tokens yet. Create one to connect an MCP client.</p>
                )}

                <div className="hr" />
                <div className="stack-sm">
                  <div className="form-row" style={{ justifyContent: 'space-between' }}>
                    <strong style={{ fontSize: 13 }}>Client configuration</strong>
                    <CopyButton value={mcpSnippet} onCopied={(message) => toast(message, 'success')} />
                  </div>
                  <pre className="code-block">{mcpSnippet}</pre>
                  <div className="form-row" style={{ justifyContent: 'space-between' }}>
                    <span className="field-hint">Claude Code one-liner:</span>
                    <CopyButton
                      value={`claude mcp add --transport http cove ${settings.mcp.endpoint} --header "Authorization: Bearer YOUR_TOKEN"`}
                      onCopied={(message) => toast(message, 'success')}
                    />
                  </div>
                  <pre className="code-block">{`claude mcp add --transport http cove ${settings.mcp.endpoint} \\\n  --header "Authorization: Bearer YOUR_TOKEN"`}</pre>
                  <div className="form-row" style={{ justifyContent: 'space-between' }}>
                    <span className="field-hint">Test the endpoint:</span>
                    <CopyButton value={curSnippet} onCopied={(message) => toast(message, 'success')} />
                  </div>
                  <pre className="code-block">{curSnippet}</pre>
                  <p className="field-hint">
                    Tools exposed: overview, spending, transactions, budgets, cash flow, net worth, recurring bills,
                    investments, income and accounts. All read-only.
                  </p>
                </div>
              </Card>
            </>
          ) : null}

          {section === 'categories' ? (
            <>
              <div className="settings-section-head">
                <h2>Categories</h2>
                <p>Categories drive budgets, reports and the auto-categorizer. Transfers are excluded from income and spending.</p>
              </div>

              <Card title="Add a category">
                <div className="form-grid">
                  <Field label="Name">
                    <input
                      className="input"
                      value={newCategory.name}
                      onChange={(event) => setNewCategory({ ...newCategory, name: event.target.value })}
                      placeholder="Hobbies"
                    />
                  </Field>
                  <Field label="Type">
                    <select
                      className="input"
                      value={newCategory.kind}
                      onChange={(event) => setNewCategory({ ...newCategory, kind: event.target.value })}
                    >
                      <option value="expense">Expense</option>
                      <option value="income">Income</option>
                      <option value="transfer">Transfer</option>
                    </select>
                  </Field>
                  <Field label="Colour">
                    <input
                      className="input"
                      type="color"
                      value={newCategory.color}
                      onChange={(event) => setNewCategory({ ...newCategory, color: event.target.value })}
                      style={{ padding: 3, height: 38 }}
                    />
                  </Field>
                  <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                    <Button onClick={addCategory} loading={busy} disabled={!newCategory.name.trim()}>
                      Add category
                    </Button>
                  </div>
                </div>
              </Card>

              {['expense', 'income', 'transfer'].map((kind) => {
                const group = categories.filter((category) => category.kind === kind);
                if (!group.length) return null;
                return (
                  <Card key={kind} title={`${kind[0].toUpperCase()}${kind.slice(1)} categories`} subtitle={`${group.length} categories`} flush>
                    <div>
                      {group.map((category) => (
                        <div className="category-row" key={category.id}>
                          <span className="cat-dot" style={{ background: category.color, width: 9, height: 9 }} />
                          <div className="token-main">
                            <div className="token-name">{category.name}</div>
                            <div className="token-meta">
                              {category.transaction_count} transactions
                              {category.budget ? ` · budget ${(category.budget / 100).toFixed(2)}` : ''}
                            </div>
                          </div>
                          <Badge color={KIND_COLORS[category.kind]}>{category.kind}</Badge>
                          <button
                            type="button"
                            className="icon-btn"
                            onClick={() => deleteCategory(category)}
                            aria-label={`Delete ${category.name}`}
                          >
                            <Icon name="trash" size={15} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </Card>
                );
              })}
            </>
          ) : null}

          {section === 'data' ? (
            <>
              <div className="settings-section-head">
                <h2>Data & preferences</h2>
                <p>Export a copy of your transactions, manage demo data, and see how Cove is running.</p>
              </div>

              <Card title="Preferences">
                <div className="form-grid">
                  <Field label="Display currency" hint="Applied across the dashboard. Amounts are not converted.">
                    <select className="input" value={currency} onChange={(event) => setCurrency(event.target.value)}>
                      {['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'CHF', 'SEK', 'NOK', 'DKK', 'NZD', 'INR', 'SGD'].map((code) => (
                        <option key={code} value={code}>
                          {code}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                    <Button variant="ghost" onClick={saveCurrency} loading={busy}>
                      Save preferences
                    </Button>
                  </div>
                </div>
              </Card>

              <Card title="Your data" subtitle="Stored in a single SQLite database on this server">
                <div className="stack-sm">
                  <div className="kv">
                    <span>Accounts</span>
                    <strong>{settings.stats.accounts}</strong>
                  </div>
                  <div className="kv">
                    <span>Transactions</span>
                    <strong>{settings.stats.transactions}</strong>
                  </div>
                  <div className="kv">
                    <span>Categories</span>
                    <strong>{settings.stats.categories}</strong>
                  </div>
                  <div className="kv">
                    <span>Last bank sync</span>
                    <strong>{settings.stats.lastSync ? formatDate(settings.stats.lastSync.slice(0, 10)) : 'Never'}</strong>
                  </div>
                  <div className="form-row" style={{ marginTop: 10 }}>
                    <a className="btn btn-ghost btn-sm" href="/api/export/transactions.csv">
                      <Icon name="download" size={15} /> Export transactions CSV
                    </a>
                    <Button size="sm" variant="subtle" icon="trash" onClick={clearChat}>
                      Clear assistant history
                    </Button>
                  </div>
                </div>
              </Card>

              <Card title="Demo data" subtitle="A removable 14-month sample dataset">
                <p className="field-hint" style={{ marginBottom: 12 }}>
                  Load demo accounts, transactions, budgets and a portfolio to explore the app. Demo data uses the
                  institution name “Cove Demo” and never mixes with your real accounts.
                </p>
                <div className="form-row">
                  <Button variant="ghost" onClick={loadDemo} loading={busy} disabled={busy}>
                    Load demo data
                  </Button>
                  <Button variant="danger" onClick={clearDemo} disabled={busy}>
                    Remove demo data
                  </Button>
                </div>
              </Card>

              <Card title="About this instance">
                <div className="stack-sm">
                  <div className="kv">
                    <span>Version</span>
                    <strong>{settings.app.version}</strong>
                  </div>
                  <div className="kv">
                    <span>Public URL</span>
                    <strong>{settings.app.appUrl}</strong>
                  </div>
                  <div className="kv">
                    <span>Data directory</span>
                    <strong>{settings.app.dataDir}</strong>
                  </div>
                  <div className="kv">
                    <span>Node.js</span>
                    <strong>{settings.app.node}</strong>
                  </div>
                  <div className="kv">
                    <span>Database</span>
                    <strong>SQLite (WAL)</strong>
                  </div>
                </div>
              </Card>
            </>
          ) : null}
        </div>
      </div>
    </>
  );
}
