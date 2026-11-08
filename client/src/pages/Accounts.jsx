import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import Icon from '../icons.jsx';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  InlineError,
  Loading,
  Modal,
  Money,
  PageHeader,
} from '../components.jsx';
import { useApp, useToast } from '../state.jsx';
import { formatDate, parseMoneyInput } from '../format.js';

const TYPES = [
  { value: 'checking', label: 'Checking' },
  { value: 'savings', label: 'Savings' },
  { value: 'credit', label: 'Credit card' },
  { value: 'loan', label: 'Loan' },
  { value: 'investment', label: 'Investment' },
  { value: 'cash', label: 'Cash' },
  { value: 'other', label: 'Other' },
];

const GROUPS = [
  { title: 'Cash & savings', types: ['checking', 'savings', 'cash'] },
  { title: 'Credit & loans', types: ['credit', 'loan'] },
  { title: 'Investments', types: ['investment'] },
  { title: 'Other', types: ['other'] },
];

const loadPlaidScript = () =>
  new Promise((resolve, reject) => {
    if (window.Plaid) return resolve();
    const script = document.createElement('script');
    script.src = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js';
    script.onload = resolve;
    script.onerror = () => reject(new Error('Could not load Plaid Link. Check your network connection.'));
    document.head.appendChild(script);
  });

function AccountModal({ account, onClose, onSaved, toast }) {
  const isEdit = Boolean(account);
  const [form, setForm] = useState({
    name: account?.name || '',
    type: account?.type || 'checking',
    institution: account?.institution || '',
    mask: account?.mask || '',
    balance: account ? (account.balance_cents / 100).toFixed(2) : '',
    includeInNetworth: account ? Boolean(account.include_in_networth) : true,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      if (!form.name.trim()) throw new Error('Give the account a name');
      const payload = {
        name: form.name,
        type: form.type,
        institution: form.institution,
        mask: form.mask,
        balance: form.balance,
        includeInNetworth: form.includeInNetworth,
      };
      if (isEdit) await api.patch(`/accounts/${account.id}`, payload);
      else await api.post('/accounts', payload);
      toast(isEdit ? 'Account updated' : 'Account added', 'success');
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      title={isEdit ? 'Edit account' : 'Add an account'}
      subtitle={isEdit ? 'Balances you change here are recorded in your net worth history.' : 'Manually track cash, a local account, or an institution without a feed.'}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy}>
            {isEdit ? 'Save changes' : 'Add account'}
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Account name" className="full">
          <input
            className="input"
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            placeholder="Everyday Checking"
            autoFocus
          />
        </Field>
        <Field label="Type">
          <select className="input" value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })}>
            {TYPES.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Institution">
          <input
            className="input"
            value={form.institution}
            onChange={(event) => setForm({ ...form, institution: event.target.value })}
            placeholder="Optional"
          />
        </Field>
        <Field label={form.type === 'credit' || form.type === 'loan' ? 'Balance owed' : 'Current balance'}>
          <input
            className="input"
            value={form.balance}
            onChange={(event) => setForm({ ...form, balance: event.target.value })}
            placeholder="0.00"
            inputMode="decimal"
          />
        </Field>
        <Field label="Last 4 digits">
          <input
            className="input"
            value={form.mask}
            onChange={(event) => setForm({ ...form, mask: event.target.value })}
            placeholder="Optional"
            maxLength={4}
          />
        </Field>
        <label className="checkbox full">
          <input
            type="checkbox"
            checked={form.includeInNetworth}
            onChange={(event) => setForm({ ...form, includeInNetworth: event.target.checked })}
          />
          <span>Include this account in net worth</span>
        </label>
        <div className="full">
          <InlineError>{error}</InlineError>
        </div>
      </div>
    </Modal>
  );
}

export default function AccountsPage() {
  const [accounts, setAccounts] = useState([]);
  const [plaid, setPlaid] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);
  const [adding, setAdding] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const { prefs } = useApp();
  const toast = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [accountResult, plaidResult] = await Promise.all([api.get('/accounts'), api.get('/plaid/status')]);
      setAccounts(accountResult.accounts);
      setPlaid(plaidResult);
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

  const connectBank = async (sandbox = false) => {
    setConnecting(true);
    try {
      if (sandbox) {
        const result = await api.post('/plaid/sandbox');
        toast(`Sandbox bank linked — ${result.added} transactions imported`, 'success');
        await load();
        return;
      }

      const { link_token: linkToken } = await api.post('/plaid/link-token');
      await loadPlaidScript();
      const handler = window.Plaid.create({
        token: linkToken,
        onSuccess: async (publicToken, metadata) => {
          try {
            const result = await api.post('/plaid/exchange', {
              public_token: publicToken,
              institution: metadata?.institution || null,
            });
            toast(`Bank linked — ${result.added} transactions imported`, 'success');
            await load();
          } catch (err) {
            toast(err.message, 'error');
          }
        },
        onExit: (err) => {
          if (err) toast(err.display_message || 'Bank connection closed', 'error');
        },
      });
      handler.open();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setConnecting(false);
    }
  };

  const syncNow = async (itemId) => {
    setSyncing(true);
    try {
      const result = await api.post('/plaid/sync', itemId ? { itemId } : {});
      const totals = (result.results || []).reduce(
        (sum, entry) => ({
          added: sum.added + (entry.added || 0),
          modified: sum.modified + (entry.modified || 0),
          errors: sum.errors + (entry.error ? 1 : 0),
        }),
        { added: 0, modified: 0, errors: 0 },
      );
      toast(
        totals.errors
          ? `Sync finished with ${totals.errors} error(s)`
          : `Sync complete — ${totals.added} new, ${totals.modified} updated`,
        totals.errors ? 'error' : 'success',
      );
      await load();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSyncing(false);
    }
  };

  const removeItem = async (item) => {
    if (!window.confirm(`Disconnect ${item.institution_name || 'this bank'}? Its accounts and transactions will be removed from Cove.`)) return;
    try {
      await api.del(`/plaid/items/${item.id}`);
      toast('Bank disconnected', 'success');
      await load();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const removeAccount = async (account) => {
    if (!window.confirm(`Delete “${account.name}” and all of its transactions? This cannot be undone.`)) return;
    try {
      await api.del(`/accounts/${account.id}`);
      toast('Account deleted', 'success');
      await load();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const totals = accounts.reduce(
    (sum, account) => {
      if (!account.include_in_networth) return sum;
      if (account.is_liability) sum.liabilities += account.balance_cents;
      else sum.assets += account.balance_cents;
      return sum;
    },
    { assets: 0, liabilities: 0 },
  );

  const header = (
    <PageHeader title="Accounts" subtitle="Every balance that makes up your net worth.">
      <Button variant="ghost" icon="refresh" onClick={() => syncNow()} loading={syncing} disabled={!plaid?.items?.length}>
        Sync all
      </Button>
      <Button icon="plus" onClick={() => setAdding(true)}>
        Add account
      </Button>
    </PageHeader>
  );

  return (
    <>
      {header}
      {error ? <InlineError>{error}</InlineError> : null}

      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
        <div className="kpi">
          <span className="kpi-label">Net worth</span>
          <div className={`kpi-value ${totals.assets - totals.liabilities >= 0 ? 'accent' : ''}`}>
            <Money cents={totals.assets - totals.liabilities} />
          </div>
          <div className="kpi-foot">{accounts.length} accounts</div>
        </div>
        <div className="kpi">
          <span className="kpi-label">Assets</span>
          <div className="kpi-value">
            <Money cents={totals.assets} />
          </div>
          <div className="kpi-foot">Cash, savings and investments</div>
        </div>
        <div className="kpi">
          <span className="kpi-label">Liabilities</span>
          <div className="kpi-value">
            <Money cents={totals.liabilities} />
          </div>
          <div className="kpi-foot">Credit cards and loans</div>
        </div>
      </div>

      <div className="grid">
        <Card className="span-7" title="Bank connections" subtitle="Automatic transaction sync through Plaid">
          {plaid?.configured ? (
            <>
              <div className="form-row" style={{ marginBottom: 14 }}>
                <Badge color={plaid.environment === 'production' ? 'var(--accent)' : 'var(--warning)'}>
                  {plaid.environment}
                </Badge>
                <Button size="sm" icon="link" onClick={() => connectBank(false)} loading={connecting}>
                  Connect a bank
                </Button>
                {plaid.environment === 'sandbox' ? (
                  <Button size="sm" variant="subtle" onClick={() => connectBank(true)} loading={connecting}>
                    Add sandbox bank
                  </Button>
                ) : null}
              </div>
              {plaid.items?.length ? (
                <div className="connection-list">
                  {plaid.items.map((item) => (
                    <div className="connection-row" key={item.id}>
                      <span className="account-type-icon">
                        <Icon name="bank" size={16} />
                      </span>
                      <div className="token-main">
                        <div className="token-name">{item.institution_name || `Connection ${item.id}`}</div>
                        <div className="token-meta">
                          {item.account_count} accounts ·{' '}
                          {item.last_synced_at ? `synced ${formatDate(item.last_synced_at.slice(0, 10))}` : 'not synced yet'}
                        </div>
                        {item.last_error ? <div className="conn-error">{item.last_error}</div> : null}
                      </div>
                      <Button size="sm" variant="subtle" onClick={() => syncNow(item.id)} loading={syncing}>
                        Sync
                      </Button>
                      <button type="button" className="icon-btn" onClick={() => removeItem(item)} aria-label="Disconnect bank">
                        <Icon name="trash" size={15} />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState
                  compact
                  icon="bank"
                  title="No banks linked yet"
                  description="Plaid handles the secure login. Cove only stores an encrypted access token and your transactions."
                />
              )}
            </>
          ) : (
            <div className="stack">
              <div className="notice notice-warn">
                <Icon name="alert" size={16} />
                <div>
                  <strong>Plaid is not configured.</strong> Add <span className="mono">PLAID_CLIENT_ID</span> and{' '}
                  <span className="mono">PLAID_SECRET</span> to your <span className="mono">.env</span>, then restart Cove to
                  connect banks. CSV, OFX and QFX import works without it.
                </div>
              </div>
              <div className="stack-sm">
                <div className="kv">
                  <span>Where to get keys</span>
                  <strong>dashboard.plaid.com → Team settings → Keys</strong>
                </div>
                <div className="kv">
                  <span>Start in</span>
                  <strong>Sandbox (free, fake banks)</strong>
                </div>
                <div className="kv">
                  <span>Production</span>
                  <strong>Requires a Plaid account and per-item pricing</strong>
                </div>
              </div>
            </div>
          )}
        </Card>

        <Card className="span-5" title="Manual accounts" subtitle="Balances you keep up to date yourself">
          <div className="stack-sm">
            <div className="tip">
              <Icon name="edit" size={16} />
              <p>Update a manual balance whenever you like — Cove records a snapshot for net worth history.</p>
            </div>
            <div className="tip">
              <Icon name="shield" size={16} />
              <p>Nothing leaves your server. Manual accounts are stored in the local SQLite database.</p>
            </div>
            <Button variant="subtle" size="sm" icon="plus" onClick={() => setAdding(true)}>
              Add a manual account
            </Button>
          </div>
        </Card>
      </div>

      {loading && !accounts.length ? (
        <Loading rows={3} height={100} />
      ) : accounts.length ? (
        GROUPS.map((group) => {
          const groupAccounts = accounts.filter((account) => group.types.includes(account.type));
          if (!groupAccounts.length) return null;
          return (
            <div key={group.title}>
              <div className="section-title">
                <h2>{group.title}</h2>
                <span className="dim" style={{ fontSize: 11.5 }}>
                  {groupAccounts.length} account{groupAccounts.length === 1 ? '' : 's'}
                </span>
              </div>
              <div className="account-grid">
                {groupAccounts.map((account) => (
                  <div className="account-card" key={account.id}>
                    <div className="account-top">
                      <div style={{ minWidth: 0 }}>
                        <div className="account-name">{account.name}</div>
                        <div className="account-inst">
                          {account.institution || 'Manual account'}
                          {account.mask ? ` · •${account.mask}` : ''}
                        </div>
                      </div>
                      <span className="account-type-icon">
                        <Icon name={account.type === 'investment' ? 'investments' : 'wallet'} size={16} />
                      </span>
                    </div>
                    <div>
                      <div className="account-balance">
                        <Money cents={account.balance_cents} />
                      </div>
                      <div className="bill-sub">
                        {account.is_liability ? 'Owed' : 'Available'} · {account.transaction_count} transactions
                      </div>
                    </div>
                    <div className="account-actions">
                      {account.plaid_account_id ? (
                        <Badge color="var(--accent)">Synced</Badge>
                      ) : (
                        <Badge color="var(--text-3)">Manual</Badge>
                      )}
                      <button type="button" className="icon-btn" onClick={() => setEditing(account)} aria-label="Edit account">
                        <Icon name="edit" size={15} />
                      </button>
                      <button type="button" className="icon-btn" onClick={() => removeAccount(account)} aria-label="Delete account">
                        <Icon name="trash" size={15} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })
      ) : (
        <Card>
          <EmptyState
            icon="accounts"
            title="No accounts yet"
            description="Add a manual account or connect a bank to start building your financial picture."
            action={
              <div className="form-row">
                <Button icon="plus" onClick={() => setAdding(true)}>
                  Add account
                </Button>
                {plaid?.configured ? <Button variant="ghost" icon="link" onClick={() => connectBank(false)}>Connect bank</Button> : null}
              </div>
            }
          />
        </Card>
      )}

      {adding ? (
        <AccountModal
          toast={toast}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            load();
          }}
        />
      ) : null}
      {editing ? (
        <AccountModal
          account={editing}
          toast={toast}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      ) : null}

      <p className="page-foot-note">
        Net worth = assets − liabilities. Credit cards and loans count as liabilities, in {prefs.currency}.
      </p>
    </>
  );
}
