import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, queryString } from '../api.js';
import Icon from '../icons.jsx';
import {
  Badge,
  Button,
  Card,
  CategoryDot,
  EmptyState,
  Field,
  InlineError,
  Loading,
  Modal,
  Money,
  PageHeader,
} from '../components.jsx';
import { useApp, useRouter, useToast } from '../state.jsx';
import { formatMoney, parseMoneyInput, todayISO } from '../format.js';

function EditModal({ transaction, categories, onClose, onSaved, toast }) {
  const [form, setForm] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!transaction) return;
    setForm({
      name: transaction.name,
      date: transaction.date,
      amount: (transaction.amount_cents / 100).toFixed(2),
      categoryId: transaction.category_id ? String(transaction.category_id) : '',
      notes: transaction.notes || '',
      applyToSimilar: false,
      excluded: Boolean(transaction.excluded),
    });
    setError('');
    setConfirming(false);
  }, [transaction]);

  if (!transaction || !form) return null;

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      await api.patch(`/transactions/${transaction.id}`, {
        name: form.name,
        date: form.date,
        amount: form.amount,
        categoryId: form.categoryId ? Number(form.categoryId) : null,
        notes: form.notes,
        excluded: form.excluded,
        applyToSimilar: form.applyToSimilar,
      });
      toast('Transaction updated', 'success');
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const createRule = async () => {
    if (!form.categoryId) {
      setError('Choose a category first');
      return;
    }
    setBusy(true);
    try {
      const result = await api.post(`/transactions/${transaction.id}/rule`, {
        categoryId: Number(form.categoryId),
      });
      toast(`Rule saved — ${result.affected} transactions re-checked`, 'success');
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setBusy(true);
    try {
      await api.del(`/transactions/${transaction.id}`);
      toast('Transaction deleted', 'success');
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
      title="Edit transaction"
      subtitle={`${transaction.account_name}${transaction.pending ? ' · pending' : ''}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="danger" size="sm" onClick={remove} loading={busy}>
            {confirming ? 'Confirm delete' : 'Delete'}
          </Button>
          <div style={{ flex: 1 }} />
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} loading={busy}>
            Save changes
          </Button>
        </>
      }
    >
      <div className="stack">
        <div className="form-grid">
          <Field label="Description" className="full">
            <input className="input" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          </Field>
          <Field label="Date">
            <input
              className="input"
              type="date"
              value={form.date}
              onChange={(event) => setForm({ ...form, date: event.target.value })}
            />
          </Field>
          <Field label="Amount" hint="Negative for money out, positive for money in.">
            <input
              className="input"
              value={form.amount}
              onChange={(event) => setForm({ ...form, amount: event.target.value })}
              inputMode="decimal"
            />
          </Field>
          <Field label="Category" className="full">
            <select
              className="input"
              value={form.categoryId}
              onChange={(event) => setForm({ ...form, categoryId: event.target.value })}
            >
              <option value="">Uncategorized</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name} · {category.kind}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Notes" className="full">
            <textarea
              className="input"
              rows={2}
              value={form.notes}
              onChange={(event) => setForm({ ...form, notes: event.target.value })}
              placeholder="Optional note for this transaction"
            />
          </Field>
        </div>

        <label className="checkbox">
          <input
            type="checkbox"
            checked={form.applyToSimilar}
            onChange={(event) => setForm({ ...form, applyToSimilar: event.target.checked })}
          />
          <span>Apply this category to similar transactions from the same merchant</span>
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={form.excluded}
            onChange={(event) => setForm({ ...form, excluded: event.target.checked })}
          />
          <span>Exclude from reports and budgets (the transaction stays in your list)</span>
        </label>

        <InlineError>{error}</InlineError>

        <div className="form-row">
          <Button variant="subtle" size="sm" icon="repeat" onClick={createRule} loading={busy}>
            Always categorize “{transaction.merchant_name || transaction.name}” this way
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function AddModal({ accounts, categories, onClose, onSaved, toast }) {
  const [form, setForm] = useState({
    accountId: accounts[0]?.id ? String(accounts[0].id) : '',
    date: todayISO(),
    description: '',
    amount: '',
    kind: 'expense',
    categoryId: '',
    notes: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      const cents = Math.abs(parseMoneyInput(form.amount));
      if (!cents) throw new Error('Enter a non-zero amount');
      await api.post('/transactions', {
        accountId: Number(form.accountId),
        date: form.date,
        description: form.description,
        amount: (form.kind === 'expense' ? -cents : cents) / 100,
        categoryId: form.categoryId ? Number(form.categoryId) : null,
        notes: form.notes,
      });
      toast('Transaction added', 'success');
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
      title="Add transaction"
      subtitle="Record a cash purchase or anything a bank feed might miss."
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy}>
            Add transaction
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Account" className="full">
          <select className="input" value={form.accountId} onChange={(event) => setForm({ ...form, accountId: event.target.value })}>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Description" className="full">
          <input
            className="input"
            value={form.description}
            onChange={(event) => setForm({ ...form, description: event.target.value })}
            placeholder="Coffee with Sam"
            autoFocus
          />
        </Field>
        <Field label="Type">
          <select className="input" value={form.kind} onChange={(event) => setForm({ ...form, kind: event.target.value })}>
            <option value="expense">Money out</option>
            <option value="income">Money in</option>
          </select>
        </Field>
        <Field label="Amount">
          <input
            className="input"
            value={form.amount}
            onChange={(event) => setForm({ ...form, amount: event.target.value })}
            placeholder="24.50"
            inputMode="decimal"
          />
        </Field>
        <Field label="Date">
          <input
            className="input"
            type="date"
            value={form.date}
            onChange={(event) => setForm({ ...form, date: event.target.value })}
          />
        </Field>
        <Field label="Category">
          <select
            className="input"
            value={form.categoryId}
            onChange={(event) => setForm({ ...form, categoryId: event.target.value })}
          >
            <option value="">Uncategorized</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Notes" className="full">
          <input className="input" value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
        </Field>
        <div className="full">
          <InlineError>{error}</InlineError>
        </div>
      </div>
    </Modal>
  );
}

export default function TransactionsPage() {
  const [accounts, setAccounts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [filters, setFilters] = useState({
    search: '',
    account: '',
    category: '',
    from: '',
    to: '',
    uncategorized: false,
  });
  const [searchInput, setSearchInput] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState([]);
  const [bulkCategory, setBulkCategory] = useState('');
  const [detail, setDetail] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const { prefs } = useApp();
  const { navigate } = useRouter();
  const toast = useToast();

  useEffect(() => {
    const timer = setTimeout(() => {
      setFilters((current) => ({ ...current, search: searchInput }));
      setPage(1);
    }, 320);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const loadMeta = useCallback(async () => {
    try {
      const [accountsResult, categoriesResult] = await Promise.all([api.get('/accounts'), api.get('/categories')]);
      setAccounts(accountsResult.accounts);
      setCategories(categoriesResult.categories);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = queryString({
        search: filters.search,
        account: filters.account,
        category: filters.category,
        from: filters.from,
        to: filters.to,
        uncategorized: filters.uncategorized ? '1' : '',
        page,
        limit: 40,
      });
      const result = await api.get(`/transactions${qs}`);
      setData(result);
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [filters, page]);

  useEffect(() => {
    loadMeta();
  }, [loadMeta]);

  useEffect(() => {
    load();
  }, [load]);

  const updateCategory = async (transaction, categoryId) => {
    try {
      await api.patch(`/transactions/${transaction.id}`, {
        categoryId: categoryId ? Number(categoryId) : null,
      });
      toast(categoryId ? 'Category updated' : 'Moved to Uncategorized', 'success');
      load();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const applyBulk = async () => {
    if (!selected.length) return;
    try {
      await api.post('/transactions/bulk', {
        ids: selected,
        categoryId: bulkCategory ? Number(bulkCategory) : null,
      });
      toast(`${selected.length} transactions updated`, 'success');
      setSelected([]);
      load();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const toggleSelected = (id) => {
    setSelected((current) => (current.includes(id) ? current.filter((value) => value !== id) : [...current, id]));
  };

  const allSelected = useMemo(
    () => Boolean(data?.items.length) && data.items.every((tx) => selected.includes(tx.id)),
    [data, selected],
  );

  const toggleAll = () => {
    if (!data) return;
    if (allSelected) setSelected([]);
    else setSelected(data.items.map((tx) => tx.id));
  };

  const exportHref = `/api/export/transactions.csv${queryString({
    search: filters.search,
    account: filters.account,
    category: filters.category,
    from: filters.from,
    to: filters.to,
  })}`;

  const resetFilters = () => {
    setSearchInput('');
    setFilters({ search: '', account: '', category: '', from: '', to: '', uncategorized: false });
    setPage(1);
  };

  return (
    <>
      <PageHeader title="Transactions" subtitle="Every dollar in and out, searchable and editable.">
        <Button variant="ghost" icon="upload" onClick={() => navigate('/import')}>
          Import
        </Button>
        <Button icon="plus" onClick={() => setAddOpen(true)} disabled={!accounts.length}>
          Add transaction
        </Button>
      </PageHeader>

      {!accounts.length ? (
        <Card>
          <EmptyState
            icon="accounts"
            title="Add an account first"
            description="Create a manual account or connect your bank, then transactions will have somewhere to live."
            action={
              <Button icon="plus" onClick={() => navigate('/accounts')}>
                Go to accounts
              </Button>
            }
          />
        </Card>
      ) : (
        <Card flush>
          <div className="toolbar">
            <div className="search-wrap">
              <Icon name="search" size={15} />
              <input
                className="input"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Search descriptions, merchants, notes…"
              />
            </div>
            <select
              className="input"
              value={filters.account}
              onChange={(event) => {
                setFilters({ ...filters, account: event.target.value });
                setPage(1);
              }}
            >
              <option value="">All accounts</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
            <select
              className="input"
              value={filters.uncategorized ? 'none' : filters.category}
              onChange={(event) => {
                const value = event.target.value;
                setFilters({ ...filters, category: value === 'none' ? '' : value, uncategorized: value === 'none' });
                setPage(1);
              }}
            >
              <option value="">All categories</option>
              <option value="none">Uncategorized</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
            <input
              className="input"
              type="date"
              value={filters.from}
              onChange={(event) => {
                setFilters({ ...filters, from: event.target.value });
                setPage(1);
              }}
              aria-label="From date"
            />
            <input
              className="input"
              type="date"
              value={filters.to}
              onChange={(event) => {
                setFilters({ ...filters, to: event.target.value });
                setPage(1);
              }}
              aria-label="To date"
            />
            <Button variant="subtle" size="sm" onClick={resetFilters}>
              Reset
            </Button>
            <a className="btn btn-ghost btn-sm" href={exportHref}>
              <Icon name="download" size={15} /> Export
            </a>
          </div>

          {selected.length ? (
            <div className="bulk-bar">
              <strong>{selected.length} selected</strong>
              <span className="dim">Set category:</span>
              <select className="input input-sm" value={bulkCategory} onChange={(event) => setBulkCategory(event.target.value)}>
                <option value="">Uncategorized</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
              <Button size="sm" onClick={applyBulk}>
                Apply
              </Button>
              <Button size="sm" variant="subtle" onClick={() => setSelected([])}>
                Clear
              </Button>
            </div>
          ) : null}

          {error ? <div style={{ padding: 16 }}><InlineError>{error}</InlineError></div> : null}

          {loading && !data ? (
            <div style={{ padding: 16 }}>
              <Loading rows={6} height={44} />
            </div>
          ) : data?.items.length ? (
            <>
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th style={{ width: 34 }}>
                        <input
                          type="checkbox"
                          className="row-check"
                          checked={allSelected}
                          onChange={toggleAll}
                          aria-label="Select all transactions"
                        />
                      </th>
                      <th>Date</th>
                      <th>Description</th>
                      <th>Account</th>
                      <th>Category</th>
                      <th className="num">Amount</th>
                      <th style={{ width: 38 }} />
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((tx) => (
                      <tr key={tx.id} className={selected.includes(tx.id) ? 'selected' : ''}>
                        <td>
                          <input
                            type="checkbox"
                            className="row-check"
                            checked={selected.includes(tx.id)}
                            onChange={() => toggleSelected(tx.id)}
                            aria-label={`Select ${tx.name}`}
                          />
                        </td>
                        <td className="dim nowrap">{tx.date}</td>
                        <td className="desc-cell">
                          <div className="desc-primary">{tx.merchant_name || tx.name}</div>
                          <div className="desc-secondary">
                            {tx.pending ? <Badge color="var(--warning)">Pending</Badge> : null}
                            {tx.excluded ? <Badge color="var(--text-3)">Excluded</Badge> : null}
                            {tx.notes ? tx.notes : tx.category_source === 'manual' ? 'Manually categorized' : ''}
                          </div>
                        </td>
                        <td className="dim">{tx.account_name}</td>
                        <td>
                          <span className="cat-cell">
                            <CategoryDot color={tx.category_color || '#5b6b63'} />
                            <select
                              className="select-inline"
                              value={tx.category_id || ''}
                              onChange={(event) => updateCategory(tx, event.target.value)}
                              aria-label={`Category for ${tx.name}`}
                            >
                              <option value="">Uncategorized</option>
                              {categories.map((category) => (
                                <option key={category.id} value={category.id}>
                                  {category.name}
                                </option>
                              ))}
                            </select>
                          </span>
                        </td>
                        <td className={`num ${tx.amount_cents > 0 ? 'amount-pos' : 'amount-neg'}`}>
                          <Money cents={tx.amount_cents} alwaysSign={tx.amount_cents > 0} />
                        </td>
                        <td>
                          <button type="button" className="icon-btn" onClick={() => setDetail(tx)} aria-label="Edit transaction">
                            <Icon name="edit" size={15} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="table-foot">
                <div className="form-row">
                  <span className="chip">
                    Out <strong>{formatMoney(data.outflow, prefs.currency)}</strong>
                  </span>
                  <span className="chip">
                    In <strong>{formatMoney(data.inflow, prefs.currency)}</strong>
                  </span>
                  <span className="dim">{data.total} transactions</span>
                </div>
                <div className="pager">
                  <Button
                    size="sm"
                    variant="subtle"
                    icon="chevronLeft"
                    disabled={page <= 1}
                    onClick={() => setPage((current) => Math.max(1, current - 1))}
                  >
                    Prev
                  </Button>
                  <span>
                    Page <strong>{data.page}</strong> of {data.pages}
                  </span>
                  <Button
                    size="sm"
                    variant="subtle"
                    disabled={page >= data.pages}
                    onClick={() => setPage((current) => current + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <EmptyState
              icon="transactions"
              title="No matching transactions"
              description="Try a different search, widen the date range, or import a statement."
              action={
                <Button variant="ghost" size="sm" onClick={resetFilters}>
                  Clear filters
                </Button>
              }
            />
          )}
        </Card>
      )}

      {detail ? (
        <EditModal
          transaction={detail}
          categories={categories}
          toast={toast}
          onClose={() => setDetail(null)}
          onSaved={() => {
            setDetail(null);
            load();
          }}
        />
      ) : null}

      {addOpen ? (
        <AddModal
          accounts={accounts}
          categories={categories}
          toast={toast}
          onClose={() => setAddOpen(false)}
          onSaved={() => {
            setAddOpen(false);
            load();
          }}
        />
      ) : null}
    </>
  );
}
