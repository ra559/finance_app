import { useCallback, useEffect, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api } from '../api.js';
import Icon, { Logo } from '../icons.jsx';
import {
  Badge,
  Button,
  Card,
  CategoryDot,
  Delta,
  EmptyState,
  InlineError,
  Loading,
  Money,
  MonthSwitcher,
  PageHeader,
  Progress,
} from '../components.jsx';
import { useApp, useRouter, useToast } from '../state.jsx';
import {
  cadenceLabels,
  currentMonthKey,
  formatDate,
  formatMoney,
  formatShortDate,
  monthLabel,
  monthShort,
} from '../format.js';

function ChartTip({ active, payload, label }) {
  const { prefs } = useApp();
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tip">
      <div className="chart-tip-label">{label}</div>
      {payload.map((entry) => (
        <div className="chart-tip-row" key={entry.dataKey}>
          <span>
            <i className="chart-tip-dot" style={{ background: entry.color }} />
            {entry.name}
          </span>
          <strong>{formatMoney(entry.value, prefs.currency)}</strong>
        </div>
      ))}
    </div>
  );
}

function Kpi({ label, value, icon, foot, accent = false, children }) {
  return (
    <div className="kpi">
      <div className="kpi-top">
        <span className="kpi-label">{label}</span>
        <span className="kpi-icon">
          <Icon name={icon} size={15} />
        </span>
      </div>
      <div className={`kpi-value ${accent ? 'accent' : ''}`}>{value}</div>
      <div className="kpi-foot">{children || foot}</div>
    </div>
  );
}

function Onboarding({ onRefresh }) {
  const { navigate } = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const { settings } = useApp();

  const loadDemo = async () => {
    setBusy(true);
    try {
      await api.post('/settings/demo');
      toast('Demo data loaded — explore the dashboard', 'success');
      onRefresh();
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="onboard">
      <div className="onboard-glow" />
      <div className="onboard-head">
        <Logo size={44} />
        <div>
          <h2>Welcome to Cove</h2>
          <p>Three ways to see your whole financial picture. Pick whichever fits.</p>
        </div>
      </div>
      <div className="onboard-steps">
        <div className="onboard-step">
          <span className="onboard-num">1</span>
          <div className="onboard-step-main">
            <strong>Connect a bank account</strong>
            <p>Automatic transaction and balance sync through Plaid. Set your keys in .env first.</p>
            <span className={`badge badge-soft ${settings?.plaid?.configured ? '' : 'dim'}`}>
              {settings?.plaid?.configured ? 'Plaid configured' : 'Needs Plaid keys'}
            </span>
          </div>
          <Button variant="ghost" size="sm" onClick={() => navigate('/accounts')}>
            Set up
          </Button>
        </div>
        <div className="onboard-step">
          <span className="onboard-num">2</span>
          <div className="onboard-step-main">
            <strong>Import a statement</strong>
            <p>CSV, OFX or QFX exports work with any bank. Cove categorizes them automatically.</p>
            <span className="badge badge-soft">No bank connection needed</span>
          </div>
          <Button variant="ghost" size="sm" onClick={() => navigate('/import')}>
            Import
          </Button>
        </div>
        <div className="onboard-step">
          <span className="onboard-num">3</span>
          <div className="onboard-step-main">
            <strong>Explore with demo data</strong>
            <p>Load 14 months of realistic transactions, budgets and a portfolio to try everything.</p>
            <span className="badge badge-soft">Removable anytime</span>
          </div>
          <Button variant="subtle" size="sm" onClick={loadDemo} loading={busy}>
            Load demo
          </Button>
        </div>
      </div>
      <p className="onboard-foot">
        <Icon name="shield" size={14} /> Your database lives in the data directory on your own server.
      </p>
    </div>
  );
}

export default function OverviewPage() {
  const [month, setMonth] = useState(currentMonthKey());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const { prefs } = useApp();
  const { navigate } = useRouter();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.get(`/dashboard?month=${month}`);
      setData(result);
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

  const fmtCompact = (value) => formatMoney(value, prefs.currency, { compact: true });

  const netWorthChart = (data?.netWorthSeries || []).map((point) => ({
    ...point,
    label: monthShort(point.month),
  }));
  const cashflowChart = (data?.cashflow || []).map((point) => ({
    ...point,
    label: monthShort(point.month),
  }));

  const slices = (() => {
    const categories = data?.spendingByCategory || [];
    if (categories.length <= 5) return categories.map((row) => ({ ...row, name: row.name }));
    const top = categories.slice(0, 4);
    const rest = categories.slice(4).reduce((sum, row) => sum + row.total, 0);
    return [...top, { name: 'Everything else', total: rest, color: '#5b6b63' }];
  })();
  const spendingTotal = slices.reduce((sum, row) => sum + row.total, 0);

  const budgetRows = (data?.budgets?.rows || [])
    .filter((row) => row.budget > 0)
    .sort((a, b) => (b.percent ?? 0) - (a.percent ?? 0))
    .slice(0, 5);

  const incomeDelta =
    data?.previous?.income > 0 ? (data.totals.income - data.previous.income) / data.previous.income : null;
  const spendingDelta =
    data?.previous?.spending > 0 ? (data.totals.spending - data.previous.spending) / data.previous.spending : null;

  const header = (
    <PageHeader title="Overview" subtitle="A clear view of where your money stands.">
      <MonthSwitcher month={month} onChange={setMonth} />
    </PageHeader>
  );

  if (loading && !data) {
    return (
      <>
        {header}
        <Loading rows={4} height={100} />
      </>
    );
  }

  if (error && !data) {
    return (
      <>
        {header}
        <InlineError>{error}</InlineError>
      </>
    );
  }

  if (data && data.accounts.length === 0) {
    return (
      <>
        {header}
        <Onboarding onRefresh={load} />
      </>
    );
  }

  return (
    <>
      {header}
      {error ? <InlineError>{error}</InlineError> : null}

      <div className="kpi-grid">
        <Kpi
          label="Net worth"
          icon="trend"
          value={<Money cents={data.netWorth.net} />}
          accent={data.netWorth.net >= 0}
        >
          <Delta percent={data.netWorth.change.percent} />
          <span>
            <Money cents={data.netWorth.assets} compact /> assets · <Money cents={data.netWorth.liabilities} compact /> debt
          </span>
        </Kpi>
        <Kpi label="Income this month" icon="download" value={<Money cents={data.totals.income} />}>
          <Delta percent={incomeDelta} />
          <span>{data.totals.incomeCount} deposits</span>
        </Kpi>
        <Kpi label="Spending this month" icon="upload" value={<Money cents={data.totals.spending} />}>
          <Delta percent={spendingDelta} invertGood />
          <span>{data.totals.spendingCount} purchases</span>
        </Kpi>
        <Kpi
          label="Cash flow"
          icon="wallet"
          value={<Money cents={data.totals.net} alwaysSign />}
          accent={data.totals.net >= 0}
        >
          <span>
            {data.totals.savingsRate !== null
              ? `${Math.round(data.totals.savingsRate * 100)}% of income kept`
              : 'No income recorded yet'}
          </span>
        </Kpi>
      </div>

      <div className="grid">
        <Card
          title="Net worth"
          subtitle="Last 12 months"
          className="span-8"
          actions={
            <Badge color={data.netWorth.change.change >= 0 ? 'var(--accent)' : 'var(--negative)'}>
              <Money cents={data.netWorth.change.change} alwaysSign />
            </Badge>
          }
        >
          <div className="chart-box">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={netWorthChart} margin={{ top: 10, right: 6, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="netFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#3ddc97" stopOpacity={0.34} />
                    <stop offset="100%" stopColor="#3ddc97" stopOpacity={0.01} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} strokeDasharray="3 6" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} dy={6} />
                <YAxis
                  tickFormatter={fmtCompact}
                  width={54}
                  tickLine={false}
                  axisLine={false}
                  domain={['dataMin - 100000', 'dataMax + 100000']}
                />
                <Tooltip content={<ChartTip />} cursor={{ stroke: 'rgba(255,255,255,.14)' }} />
                <Area
                  type="monotone"
                  dataKey="net"
                  name="Net worth"
                  stroke="#3ddc97"
                  strokeWidth={2}
                  fill="url(#netFill)"
                  activeDot={{ r: 4, fill: '#3ddc97', stroke: '#07100b' }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card
          title="Where it went"
          subtitle={monthLabel(month)}
          className="span-4"
          actions={<span className="chip">{spendingTotal > 0 ? <Money cents={spendingTotal} compact /> : 'No spending'}</span>}
        >
          {slices.length ? (
            <div className="donut-wrap">
              <div className="donut-chart">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={slices}
                      dataKey="total"
                      nameKey="name"
                      innerRadius={57}
                      outerRadius={80}
                      paddingAngle={2}
                      stroke="none"
                    >
                      {slices.map((slice) => (
                        <Cell key={slice.name} fill={slice.color} />
                      ))}
                    </Pie>
                    <Tooltip content={<ChartTip />} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="donut-center">
                  <span>Spent</span>
                  <strong>{formatMoney(spendingTotal, prefs.currency, { compact: true })}</strong>
                </div>
              </div>
              <div className="legend">
                {slices.slice(0, 6).map((slice) => (
                  <div className="legend-row" key={slice.name}>
                    <CategoryDot color={slice.color} />
                    <span>{slice.name}</span>
                    <strong>{formatMoney(slice.total, prefs.currency, { compact: true })}</strong>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <EmptyState compact icon="budgets" title="No spending yet" description="Transactions will appear here once imported." />
          )}
        </Card>
      </div>

      <div className="grid">
        <Card title="Cash flow" subtitle="Income vs spending, last 12 months" className="span-7">
          <div className="chart-box">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={cashflowChart} margin={{ top: 10, right: 6, left: 0, bottom: 0 }} barGap={2}>
                <CartesianGrid vertical={false} strokeDasharray="3 6" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} dy={6} />
                <YAxis tickFormatter={fmtCompact} width={54} tickLine={false} axisLine={false} />
                <Tooltip content={<ChartTip />} cursor={{ fill: 'rgba(255,255,255,.035)' }} />
                <Bar dataKey="income" name="Income" fill="#3ddc97" radius={[4, 4, 0, 0]} maxBarSize={16} />
                <Bar dataKey="spending" name="Spending" fill="#f7c948" radius={[4, 4, 0, 0]} maxBarSize={16} opacity={0.85} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card
          title="Budget progress"
          subtitle={monthLabel(month)}
          className="span-5"
          actions={
            <button type="button" className="link-btn" onClick={() => navigate('/budgets')}>
              Manage <Icon name="chevronRight" size={13} />
            </button>
          }
        >
          {budgetRows.length ? (
            <div className="stack-sm">
              {budgetRows.map((row) => {
                const percent = row.percent ?? 0;
                return (
                  <div key={row.categoryId} className="budget-mini">
                    <div className="budget-mini-top">
                      <span className="cat-cell">
                        <CategoryDot color={row.color} />
                        {row.name}
                      </span>
                      <span className="num">
                        <strong>{formatMoney(row.spent, prefs.currency, { compact: true })}</strong>
                        <span className="dim"> / {formatMoney(row.budget, prefs.currency, { compact: true })}</span>
                      </span>
                    </div>
                    <Progress value={percent} color={row.color} over={percent > 1} height={6} />
                  </div>
                );
              })}
              <div className="budget-mini-foot">
                <span>
                  <Money cents={data.budgets.totalSpent} compact /> of <Money cents={data.budgets.totalBudget} compact /> used
                </span>
                <span className={data.budgets.remaining < 0 ? 'neg' : 'pos'}>
                  {data.budgets.remaining >= 0 ? 'Left: ' : 'Over: '}
                  {formatMoney(Math.abs(data.budgets.remaining), prefs.currency, { compact: true })}
                </span>
              </div>
            </div>
          ) : (
            <EmptyState
              compact
              icon="budgets"
              title="No budgets yet"
              description="Set monthly limits by category to track your progress."
              action={
                <Button variant="ghost" size="sm" onClick={() => navigate('/budgets')}>
                  Create a budget
                </Button>
              }
            />
          )}
        </Card>
      </div>

      <div className="grid">
        <Card
          title="Recent activity"
          className="span-7"
          flush
          actions={
            <button type="button" className="link-btn" onClick={() => navigate('/transactions')}>
              View all <Icon name="chevronRight" size={13} />
            </button>
          }
        >
          {data.recent.length ? (
            <div className="tx-list">
              {data.recent.map((tx) => (
                <div className="tx-row" key={tx.id}>
                  <span className="tx-icon" style={{ '--tx-color': tx.category_color || '#6b7d73' }}>
                    {(tx.merchant_name || tx.name || '?').slice(0, 1).toUpperCase()}
                  </span>
                  <div className="tx-main">
                    <div className="tx-name">{tx.merchant_name || tx.name}</div>
                    <div className="tx-sub">
                      {tx.category_name || 'Uncategorized'} · {tx.account_name}
                    </div>
                  </div>
                  <div>
                    <div className={`tx-amount ${tx.amount_cents > 0 ? 'amount-pos' : 'amount-neg'}`}>
                      <Money cents={tx.amount_cents} alwaysSign={tx.amount_cents > 0} />
                    </div>
                    <div className="tx-date" style={{ textAlign: 'right' }}>
                      {formatShortDate(tx.date)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState compact icon="transactions" title="No transactions yet" description="Connect a bank or import a statement to get started." />
          )}
        </Card>

        <Card
          title="Upcoming bills"
          className="span-5"
          flush
          actions={
            <button type="button" className="link-btn" onClick={() => navigate('/recurring')}>
              Manage <Icon name="chevronRight" size={13} />
            </button>
          }
        >
          {data.upcoming.length ? (
            <div>
              {data.upcoming.map((bill) => {
                const date = new Date(`${bill.next_date}T12:00:00`);
                return (
                  <div className="bill-row" key={bill.id}>
                    <div className="bill-date">
                      <span>{date.toLocaleDateString('en-US', { month: 'short' })}</span>
                      <strong>{date.getDate()}</strong>
                    </div>
                    <div className="bill-main">
                      <div className="bill-name">{bill.name}</div>
                      <div className="bill-sub">
                        {cadenceLabels[bill.cadence] || bill.cadence}
                        {bill.category_name ? ` · ${bill.category_name}` : ''}
                      </div>
                    </div>
                    <div className="tx-amount">
                      <Money cents={Math.abs(bill.amount_cents)} />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState
              compact
              icon="recurring"
              title="No recurring bills found"
              description="Cove detects subscriptions once you have a few months of history."
            />
          )}
        </Card>
      </div>

      <p className="page-foot-note">
        Showing {monthLabel(month)} · Net worth updated {formatDate(new Date().toISOString().slice(0, 10))}
      </p>
    </>
  );
}
