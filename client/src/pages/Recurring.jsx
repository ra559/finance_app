import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import Icon from '../icons.jsx';
import {
  Badge,
  Button,
  Card,
  CategoryDot,
  EmptyState,
  InlineError,
  Loading,
  Money,
  PageHeader,
} from '../components.jsx';
import { useApp, useRouter, useToast } from '../state.jsx';
import { cadenceLabels, formatMoney, formatShortDate } from '../format.js';

function BillRow({ bill, onToggle, busy }) {
  const { prefs } = useApp();
  const date = new Date(`${bill.next_date}T12:00:00`);
  const dismissed = bill.status === 'dismissed';
  const overdue = bill.daysUntil < 0 && !dismissed;

  return (
    <div className={`bill-detail ${dismissed ? 'dismissed' : ''}`}>
      <div className="bill-date">
        <span>{date.toLocaleDateString('en-US', { month: 'short' })}</span>
        <strong>{date.getDate()}</strong>
      </div>
      <div className="bill-main">
        <div className="bill-name">
          {bill.name}
          {bill.category_name ? (
            <span className="cat-cell" style={{ marginLeft: 8, fontSize: 11, color: 'var(--text-3)' }}>
              <CategoryDot color={bill.category_color} size={6} />
              {bill.category_name}
            </span>
          ) : null}
        </div>
        <div className="bill-sub">
          {cadenceLabels[bill.cadence] || bill.cadence} · {bill.account_name || 'Account'} ·{' '}
          {dismissed
            ? 'Dismissed'
            : overdue
              ? `Due ${Math.abs(bill.daysUntil)} days ago`
              : bill.daysUntil === 0
                ? 'Due today'
                : `Due in ${bill.daysUntil} day${bill.daysUntil === 1 ? '' : 's'}`}
        </div>
      </div>
      <div className="bill-confidence">
        <Badge color={bill.confidence >= 0.85 ? 'var(--accent)' : 'var(--warning)'}>
          {bill.confidence >= 0.85 ? 'High confidence' : 'Likely'}
        </Badge>
        <span className="dim">seen {bill.occurrences}×</span>
      </div>
      <div className="bill-amount">
        <div className="tx-amount">
          <Money cents={Math.abs(bill.amount_cents)} />
        </div>
        <div className="bill-sub">
          {formatMoney(bill.monthlyEquivalent, prefs.currency, { compact: true })}/mo
        </div>
      </div>
      <Button
        size="sm"
        variant={dismissed ? 'subtle' : 'ghost'}
        onClick={() => onToggle(bill)}
        disabled={busy}
      >
        {dismissed ? 'Restore' : 'Dismiss'}
      </Button>
    </div>
  );
}

export default function RecurringPage() {
  const [bills, setBills] = useState([]);
  const [loading, setLoading] = useState(true);
  const [detecting, setDetecting] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');
  const { prefs } = useApp();
  const { navigate } = useRouter();
  const toast = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.get('/recurring');
      setBills(result.bills);
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

  const detect = async () => {
    setDetecting(true);
    try {
      const result = await api.post('/recurring/detect');
      setBills(result.bills);
      const active = result.bills.filter((bill) => bill.status === 'active');
      toast(`Found ${active.length} recurring bill${active.length === 1 ? '' : 's'}`, 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setDetecting(false);
    }
  };

  const toggle = async (bill) => {
    setBusyId(bill.id);
    try {
      const status = bill.status === 'dismissed' ? 'active' : 'dismissed';
      await api.patch(`/recurring/${bill.id}`, { status });
      setBills((current) => current.map((entry) => (entry.id === bill.id ? { ...entry, status } : entry)));
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusyId(null);
    }
  };

  const active = bills.filter((bill) => bill.status === 'active');
  const dismissed = bills.filter((bill) => bill.status === 'dismissed');
  const monthlyTotal = active.reduce((sum, bill) => sum + Math.abs(bill.monthlyEquivalent), 0);
  const upcoming = active.filter((bill) => bill.daysUntil >= 0 && bill.daysUntil <= 30);
  const nextBill = active.filter((bill) => bill.daysUntil >= 0)[0];

  const header = (
    <PageHeader title="Recurring" subtitle="Subscriptions and bills Cove spotted in your history.">
      <Button variant="ghost" icon="refresh" onClick={detect} loading={detecting}>
        Detect now
      </Button>
    </PageHeader>
  );

  if (loading && !bills.length) {
    return (
      <>
        {header}
        <Loading rows={4} height={80} />
      </>
    );
  }

  return (
    <>
      {header}
      {error ? <InlineError>{error}</InlineError> : null}

      {active.length ? (
        <>
          <div className="kpi-grid">
            <div className="kpi">
              <span className="kpi-label">Monthly commitment</span>
              <div className="kpi-value accent">
                <Money cents={monthlyTotal} />
              </div>
              <div className="kpi-foot">
                <Money cents={monthlyTotal * 12} compact /> per year
              </div>
            </div>
            <div className="kpi">
              <span className="kpi-label">Active bills</span>
              <div className="kpi-value">{active.length}</div>
              <div className="kpi-foot">{dismissed.length} dismissed</div>
            </div>
            <div className="kpi">
              <span className="kpi-label">Next 30 days</span>
              <div className="kpi-value">
                <Money cents={upcoming.reduce((sum, bill) => sum + Math.abs(bill.amount_cents), 0)} />
              </div>
              <div className="kpi-foot">{upcoming.length} payments</div>
            </div>
            <div className="kpi">
              <span className="kpi-label">Next up</span>
              <div className="kpi-value" style={{ fontSize: 21 }}>
                {nextBill ? nextBill.name : 'Nothing scheduled'}
              </div>
              <div className="kpi-foot">
                {nextBill ? `${formatShortDate(nextBill.next_date)} · ${formatMoney(Math.abs(nextBill.amount_cents), prefs.currency)}` : 'All clear'}
              </div>
            </div>
          </div>

          <Card
            title="Detected bills"
            subtitle="Cove looks for similar amounts on a regular cadence"
            actions={<span className="chip">{active.length} active</span>}
            flush
          >
            <div>{active.map((bill) => <BillRow key={bill.id} bill={bill} onToggle={toggle} busy={busyId === bill.id} />)}</div>
          </Card>
        </>
      ) : (
        <Card>
          <EmptyState
            icon="recurring"
            title="No recurring bills detected yet"
            description="Cove needs at least three payments with a regular interval. Connect a bank or import a few months of statements, then run detection."
            action={
              <div className="form-row">
                <Button icon="refresh" onClick={detect} loading={detecting}>
                  Run detection
                </Button>
                <Button variant="ghost" onClick={() => navigate('/import')}>
                  Import statements
                </Button>
              </div>
            }
          />
        </Card>
      )}

      {dismissed.length ? (
        <Card title="Dismissed" subtitle="Hidden from your dashboard and totals" flush className="dismissed-card">
          <div>
            {dismissed.map((bill) => (
              <BillRow key={bill.id} bill={bill} onToggle={toggle} busy={busyId === bill.id} />
            ))}
          </div>
        </Card>
      ) : null}

      {active.length ? (
        <div className="grid" style={{ marginTop: 16 }}>
          <Card className="span-12" title="How Cove detects bills">
            <div className="tip-grid">
              <div className="tip">
                <Icon name="clock" size={16} />
                <p>It groups transactions by merchant, then checks whether gaps between payments land on weekly, monthly, quarterly or yearly rhythms.</p>
              </div>
              <div className="tip">
                <Icon name="check" size={16} />
                <p>Amounts can wobble (utilities do). Confidence drops when the rhythm or amount is inconsistent.</p>
              </div>
              <div className="tip">
                <Icon name="alert" size={16} />
                <p>Dismiss anything that is not really recurring. It stays out of the dashboard but remains in your history.</p>
              </div>
            </div>
          </Card>
        </div>
      ) : null}

      {active.length ? (
        <p className="page-foot-note">Next dates are estimates based on past timing, not scheduled payments from the bank.</p>
      ) : null}
    </>
  );
}
