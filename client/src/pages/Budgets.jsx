import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import Icon from '../icons.jsx';
import {
  Button,
  Card,
  CategoryDot,
  EmptyState,
  InlineError,
  Loading,
  Money,
  MonthSwitcher,
  PageHeader,
  Progress,
} from '../components.jsx';
import { useApp, useRouter, useToast } from '../state.jsx';
import { currentMonthKey, formatMoney, monthLabel, parseMoneyInput } from '../format.js';

export default function BudgetsPage() {
  const [month, setMonth] = useState(currentMonthKey());
  const [status, setStatus] = useState(null);
  const [categories, setCategories] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const { prefs } = useApp();
  const { navigate } = useRouter();
  const toast = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [budgetResult, categoryResult] = await Promise.all([
        api.get(`/budgets?month=${month}`),
        api.get('/categories'),
      ]);
      setStatus(budgetResult);
      const expenses = categoryResult.categories.filter((category) => category.kind === 'expense');
      setCategories(expenses);
      const initial = {};
      for (const category of expenses) {
        initial[category.id] = category.budget ? (category.budget / 100).toFixed(2) : '';
      }
      setDrafts(initial);
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    load();
  }, [load]);

  const spentById = useMemo(() => {
    const map = new Map();
    for (const row of status?.rows || []) map.set(row.categoryId, row);
    return map;
  }, [status]);

  const dirty = useMemo(
    () =>
      categories.some((category) => {
        const draftCents = parseMoneyInput(drafts[category.id] || '');
        return draftCents !== (category.budget || 0);
      }),
    [categories, drafts],
  );

  const save = async () => {
    setSaving(true);
    try {
      const items = categories.map((category) => ({
        categoryId: category.id,
        amountCents: Math.max(parseMoneyInput(drafts[category.id] || ''), 0),
      }));
      await api.put('/budgets', { items, month });
      toast('Budget updated', 'success');
      await load();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const totals = useMemo(() => {
    let budget = 0;
    let spent = 0;
    for (const category of categories) {
      budget += Math.max(parseMoneyInput(drafts[category.id] || ''), 0);
      spent += spentById.get(category.id)?.spent || 0;
    }
    return { budget, spent, remaining: budget - spent };
  }, [categories, drafts, spentById]);

  const rows = useMemo(
    () =>
      categories
        .map((category) => {
          const budget = Math.max(parseMoneyInput(drafts[category.id] || ''), 0);
          const spent = spentById.get(category.id)?.spent || 0;
          return { ...category, budget, spent, percent: budget > 0 ? spent / budget : null };
        })
        .sort((a, b) => {
          if (a.budget && !b.budget) return -1;
          if (b.budget && !a.budget) return 1;
          return b.spent - a.spent;
        }),
    [categories, drafts, spentById],
  );

  const header = (
    <PageHeader title="Budgets" subtitle="Give every category a monthly limit and watch the pace.">
      <MonthSwitcher month={month} onChange={setMonth} />
    </PageHeader>
  );

  if (loading && !status) {
    return (
      <>
        {header}
        <Loading rows={5} height={70} />
      </>
    );
  }

  return (
    <>
      {header}
      {error ? <InlineError>{error}</InlineError> : null}

      <div className="grid">
        <Card className="span-8" title={`${monthLabel(month)} at a glance`} subtitle="Edits apply to every month until you change them">
          <div className="budget-summary">
            <div>
              <span className="kpi-label">Budgeted</span>
              <div className="kpi-value">
                <Money cents={totals.budget} />
              </div>
            </div>
            <div>
              <span className="kpi-label">Spent so far</span>
              <div className="kpi-value">
                <Money cents={totals.spent} />
              </div>
            </div>
            <div>
              <span className="kpi-label">{totals.remaining >= 0 ? 'Left to spend' : 'Over budget'}</span>
              <div className={`kpi-value ${totals.remaining < 0 ? 'danger-text' : 'accent'}`}>
                <Money cents={Math.abs(totals.remaining)} />
              </div>
            </div>
          </div>
          <div style={{ marginTop: 18 }}>
            <Progress
              value={totals.budget > 0 ? totals.spent / totals.budget : 0}
              color="var(--accent)"
              over={totals.spent > totals.budget}
              height={10}
            />
            <div className="budget-summary-foot">
              <span>
                {totals.budget > 0 ? `${Math.round((totals.spent / totals.budget) * 100)}% of budget used` : 'No budget set yet'}
              </span>
              <span>
                {status.unbudgeted > 0 ? (
                  <>
                    <Money cents={status.unbudgeted} compact /> spent in unbudgeted categories
                  </>
                ) : (
                  'All spending is covered by a budget'
                )}
              </span>
            </div>
          </div>
        </Card>

        <Card className="span-4" title="How it works" subtitle="Budgeting that stays out of your way">
          <div className="stack-sm tip-list">
            <div className="tip">
              <Icon name="budgets" size={16} />
              <p>Budgets are monthly and repeat automatically. Change them whenever life changes.</p>
            </div>
            <div className="tip">
              <Icon name="transactions" size={16} />
              <p>Spending is matched by category. Transfers and credit-card payments are left out.</p>
            </div>
            <div className="tip">
              <Icon name="alert" size={16} />
              <p>Bars turn red when a category goes over. Nothing is blocked — it is a guide, not a cage.</p>
            </div>
            <Button variant="subtle" size="sm" icon="settings" onClick={() => navigate('/settings')}>
              Manage categories
            </Button>
          </div>
        </Card>
      </div>

      <Card
        title="Category budgets"
        subtitle="Enter a monthly amount in your currency"
        actions={
          <div className="form-row">
            {dirty ? <span className="chip">Unsaved changes</span> : null}
            <Button size="sm" variant="ghost" onClick={load} disabled={!dirty || saving}>
              Reset
            </Button>
            <Button size="sm" onClick={save} loading={saving} disabled={!dirty}>
              Save budgets
            </Button>
          </div>
        }
        flush
      >
        {rows.length ? (
          <div className="budget-edit-list">
            {rows.map((row) => (
              <div className="budget-edit-row" key={row.id}>
                <div className="budget-edit-name">
                  <CategoryDot color={row.color} />
                  <span>{row.name}</span>
                </div>
                <div className="budget-edit-progress">
                  <Progress value={row.percent ?? 0} color={row.color} over={(row.percent ?? 0) > 1} />
                  <div className="budget-meta">
                    <span>
                      <Money cents={row.spent} compact /> spent
                    </span>
                    <span>
                      {row.percent !== null ? (
                        <strong>{Math.round(row.percent * 100)}%</strong>
                      ) : (
                        <strong className="dim">no limit</strong>
                      )}
                    </span>
                  </div>
                </div>
                <div className="budget-edit-input">
                  <span className="currency-prefix">{prefs.currency === 'USD' ? '$' : ''}</span>
                  <input
                    className="input input-sm"
                    value={drafts[row.id] ?? ''}
                    onChange={(event) => setDrafts({ ...drafts, [row.id]: event.target.value })}
                    placeholder="0"
                    inputMode="decimal"
                    aria-label={`Budget for ${row.name}`}
                  />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            icon="budgets"
            title="No expense categories"
            description="Create categories in Settings to start budgeting."
            action={
              <Button variant="ghost" size="sm" onClick={() => navigate('/settings')}>
                Open settings
              </Button>
            }
          />
        )}
      </Card>

      {status?.unbudgeted > 0 ? (
        <p className="page-foot-note">
          {formatMoney(status.unbudgeted, prefs.currency)} of this month&apos;s spending is in categories without a budget.
        </p>
      ) : null}
    </>
  );
}
