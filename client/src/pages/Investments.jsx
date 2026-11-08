import { useCallback, useEffect, useState } from 'react';
import {
  Area,
  AreaChart,
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
import {
  Badge,
  Button,
  Card,
  EmptyState,
  InlineError,
  Loading,
  Money,
  PageHeader,
  Progress,
} from '../components.jsx';
import { useApp, useRouter } from '../state.jsx';
import { formatMoney, formatShortDate } from '../format.js';

const TYPE_COLORS = ['#3ddc97', '#7c9cff', '#f7c948', '#f472b6', '#4cc9f0', '#c084fc', '#94a3b8'];

function PortfolioTip({ active, payload, label }) {
  const { prefs } = useApp();
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tip">
      <div className="chart-tip-label">{label}</div>
      <div className="chart-tip-row">
        <span>
          <i className="chart-tip-dot" style={{ background: '#3ddc97' }} />
          Portfolio
        </span>
        <strong>{formatMoney(payload[0].value, prefs.currency)}</strong>
      </div>
    </div>
  );
}

const typeLabel = (type) => {
  if (!type) return 'Other';
  return type
    .replace(/[_-]/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
};

export default function InvestmentsPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const { prefs } = useApp();
  const { navigate } = useRouter();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.get('/investments'));
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

  const series = (data?.series || []).map((point) => ({
    ...point,
    label: formatShortDate(point.date),
    value: point.value,
  }));

  const totalValue = data?.totalValue || 0;
  const gain = data?.gain || 0;

  const header = (
    <PageHeader title="Investments" subtitle="Holdings, allocation and how the portfolio has grown.">
      <Button variant="ghost" icon="refresh" onClick={load}>
        Refresh
      </Button>
    </PageHeader>
  );

  if (loading && !data) {
    return (
      <>
        {header}
        <Loading rows={3} height={110} />
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

  if (!data?.holdings?.length) {
    return (
      <>
        {header}
        <Card>
          <EmptyState
            icon="investments"
            title="No holdings yet"
            description="Connect an investment account through Plaid to pull in holdings, cost basis and market value. Manual investment accounts still count toward net worth — their balances live on the Accounts page."
            action={
              <div className="form-row">
                <Button icon="link" onClick={() => navigate('/accounts')}>
                  Connect an account
                </Button>
                <Button variant="ghost" onClick={() => navigate('/accounts')}>
                  View accounts
                </Button>
              </div>
            }
          />
        </Card>
      </>
    );
  }

  return (
    <>
      {header}
      {error ? <InlineError>{error}</InlineError> : null}

      <div className="kpi-grid">
        <div className="kpi">
          <div className="kpi-top">
            <span className="kpi-label">Portfolio value</span>
          </div>
          <div className="kpi-value accent">
            <Money cents={totalValue} />
          </div>
          <div className="kpi-foot">{data.holdings.length} holdings</div>
        </div>
        <div className="kpi">
          <div className="kpi-top">
            <span className="kpi-label">Cost basis</span>
          </div>
          <div className="kpi-value">
            <Money cents={data.totalCost} />
          </div>
          <div className="kpi-foot">What you paid</div>
        </div>
        <div className="kpi">
          <div className="kpi-top">
            <span className="kpi-label">Unrealized gain</span>
          </div>
          <div className={`kpi-value ${gain >= 0 ? 'accent' : 'danger-text'}`}>
            <Money cents={gain} alwaysSign />
          </div>
          <div className="kpi-foot">
            <Badge color={gain >= 0 ? 'var(--accent)' : 'var(--negative)'}>
              {data.gainPercent !== null ? `${(data.gainPercent * 100).toFixed(1)}%` : '—'}
            </Badge>
            <span>all time</span>
          </div>
        </div>
        <div className="kpi">
          <div className="kpi-top">
            <span className="kpi-label">Largest position</span>
          </div>
          <div className="kpi-value" style={{ fontSize: 22 }}>
            {data.holdings[0]?.ticker || data.holdings[0]?.name}
          </div>
          <div className="kpi-foot">
            {totalValue > 0 ? `${Math.round((data.holdings[0].value_cents / totalValue) * 100)}% of portfolio` : ''}
          </div>
        </div>
      </div>

      <div className="grid">
        <Card title="Portfolio value" subtitle="Recorded balance snapshots" className="span-8">
          {series.length >= 2 ? (
            <div className="chart-box">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={series} margin={{ top: 10, right: 6, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="portfolioFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#7c9cff" stopOpacity={0.32} />
                      <stop offset="100%" stopColor="#7c9cff" stopOpacity={0.01} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} strokeDasharray="3 6" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} dy={6} />
                  <YAxis
                    tickFormatter={(value) => formatMoney(value, prefs.currency, { compact: true })}
                    width={54}
                    tickLine={false}
                    axisLine={false}
                    domain={['dataMin - 100000', 'dataMax + 100000']}
                  />
                  <Tooltip content={<PortfolioTip />} cursor={{ stroke: 'rgba(255,255,255,.14)' }} />
                  <Area
                    type="monotone"
                    dataKey="value"
                    name="Portfolio"
                    stroke="#7c9cff"
                    strokeWidth={2}
                    fill="url(#portfolioFill)"
                    activeDot={{ r: 4, fill: '#7c9cff', stroke: '#070b09' }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyState
              compact
              icon="investments"
              title="History builds over time"
              description="Cove records a portfolio snapshot each day it syncs. Check back after a few syncs to see the trend."
            />
          )}
        </Card>

        <Card title="Allocation" subtitle="By security type" className="span-4">
          <div className="donut-wrap">
            <div className="donut-chart">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data.allocation}
                    dataKey="value"
                    nameKey="type"
                    innerRadius={57}
                    outerRadius={80}
                    paddingAngle={2}
                    stroke="none"
                  >
                    {data.allocation.map((entry, index) => (
                      <Cell key={entry.type} fill={TYPE_COLORS[index % TYPE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip content={<PortfolioTip />} />
                </PieChart>
              </ResponsiveContainer>
              <div className="donut-center">
                <span>Total</span>
                <strong>{formatMoney(totalValue, prefs.currency, { compact: true })}</strong>
              </div>
            </div>
            <div className="legend">
              {data.allocation.map((entry, index) => (
                <div className="legend-row" key={entry.type}>
                  <span className="cat-dot" style={{ background: TYPE_COLORS[index % TYPE_COLORS.length] }} />
                  <span>{typeLabel(entry.type)}</span>
                  <strong>{formatMoney(entry.value, prefs.currency, { compact: true })}</strong>
                </div>
              ))}
            </div>
          </div>
        </Card>
      </div>

      <Card title="Holdings" subtitle="Prices come from your brokerage via Plaid" flush>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Holding</th>
                <th>Account</th>
                <th className="num">Quantity</th>
                <th className="num">Price</th>
                <th className="num">Value</th>
                <th className="num">Gain</th>
                <th style={{ width: 110 }}>Weight</th>
              </tr>
            </thead>
            <tbody>
              {data.holdings.map((holding) => {
                const gainValue =
                  holding.cost_basis_cents !== null && holding.cost_basis_cents !== undefined
                    ? holding.value_cents - holding.cost_basis_cents
                    : null;
                return (
                  <tr key={holding.id}>
                    <td>
                      <div className="desc-primary">{holding.ticker || holding.name}</div>
                      <div className="desc-secondary">{holding.name}</div>
                    </td>
                    <td className="dim">{holding.account_name}</td>
                    <td className="num">{Number(holding.quantity).toLocaleString('en-US', { maximumFractionDigits: 4 })}</td>
                    <td className="num">
                      <Money cents={holding.price_cents} />
                    </td>
                    <td className="num">
                      <Money cents={holding.value_cents} />
                    </td>
                    <td className={`num ${gainValue !== null && gainValue >= 0 ? 'amount-pos' : 'amount-neg'}`}>
                      {gainValue !== null ? <Money cents={gainValue} alwaysSign={gainValue > 0} /> : '—'}
                    </td>
                    <td>
                      <Progress value={totalValue > 0 ? holding.value_cents / totalValue : 0} height={6} color="#7c9cff" />
                      <div className="desc-secondary" style={{ marginTop: 3 }}>
                        {totalValue > 0 ? `${((holding.value_cents / totalValue) * 100).toFixed(1)}%` : ''}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <p className="page-foot-note">
        Unrealized gain compares current value with cost basis reported by your brokerage. Not investment advice.
      </p>
    </>
  );
}
