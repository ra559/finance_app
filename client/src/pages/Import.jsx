import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import Icon from '../icons.jsx';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  InlineError,
  PageHeader,
  Tabs,
} from '../components.jsx';
import { useToast } from '../state.jsx';
import { formatDate } from '../format.js';

const MAPPING_FIELDS = [
  { key: 'date', label: 'Date column', required: true },
  { key: 'description', label: 'Description column', required: true },
  { key: 'amount', label: 'Amount column' },
  { key: 'debit', label: 'Debit / withdrawal column' },
  { key: 'credit', label: 'Credit / deposit column' },
  { key: 'merchant', label: 'Merchant column' },
  { key: 'category', label: 'Category column' },
  { key: 'notes', label: 'Notes column' },
];

const initialMapping = {
  date: '',
  description: '',
  merchant: '',
  amount: '',
  debit: '',
  credit: '',
  category: '',
  notes: '',
  amountMode: 'signed',
  dateFormat: 'auto',
};

export default function ImportPage() {
  const [tab, setTab] = useState('csv');
  const [accounts, setAccounts] = useState([]);
  const [accountId, setAccountId] = useState('');
  const [file, setFile] = useState(null);
  const [content, setContent] = useState('');
  const [preview, setPreview] = useState(null);
  const [mapping, setMapping] = useState(initialMapping);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [history, setHistory] = useState([]);
  const inputRef = useRef(null);
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      const [accountResult, historyResult] = await Promise.all([api.get('/accounts'), api.get('/import/history')]);
      setAccounts(accountResult.accounts);
      if (!accountId && accountResult.accounts.length) setAccountId(String(accountResult.accounts[0].id));
      setHistory(historyResult.batches);
    } catch (err) {
      setError(err.message);
    }
  }, [accountId]);

  useEffect(() => {
    load();
  }, [load]);

  const reset = () => {
    setFile(null);
    setContent('');
    setPreview(null);
    setMapping(initialMapping);
    setResult(null);
    setError('');
    if (inputRef.current) inputRef.current.value = '';
  };

  const handleFile = async (selected) => {
    if (!selected) return;
    const isCsv = /\.csv$/i.test(selected.name);
    const isOfx = /\.(ofx|qfx)$/i.test(selected.name);
    if (tab === 'csv' && !isCsv) {
      setError('Choose a .csv file, or switch to the OFX / QFX tab.');
      return;
    }
    if (tab === 'ofx' && !isOfx) {
      setError('Choose a .ofx or .qfx file, or switch to the CSV tab.');
      return;
    }
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const text = await selected.text();
      setFile({ name: selected.name, size: selected.size });
      setContent(text);
      if (tab === 'csv') {
        const previewResult = await api.post('/import/csv/preview', { content: text });
        setPreview(previewResult);
        setMapping({ ...initialMapping, ...previewResult.mapping });
      } else {
        setPreview({ totalRows: null });
      }
    } catch (err) {
      setError(err.message);
      setFile(null);
    } finally {
      setBusy(false);
    }
  };

  const runCsvImport = async () => {
    setBusy(true);
    setError('');
    try {
      if (!accountId) throw new Error('Choose an account');
      const outcome = await api.post('/import/csv', {
        accountId: Number(accountId),
        content,
        filename: file?.name || '',
        mapping,
      });
      setResult(outcome);
      toast(`${outcome.imported} transactions imported`, 'success');
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const runOfxImport = async () => {
    setBusy(true);
    setError('');
    try {
      if (!accountId) throw new Error('Choose an account');
      const outcome = await api.post('/import/ofx', {
        accountId: Number(accountId),
        content,
        filename: file?.name || '',
      });
      setResult(outcome);
      toast(`${outcome.imported} transactions imported`, 'success');
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const amountMode = mapping.amountMode;

  return (
    <>
      <PageHeader title="Import" subtitle="Bring in statements from any bank, even ones Plaid cannot reach.">
        <Tabs
          value={tab}
          onChange={(next) => {
            setTab(next);
            reset();
          }}
          tabs={[
            { value: 'csv', label: 'CSV' },
            { value: 'ofx', label: 'OFX / QFX' },
          ]}
        />
      </PageHeader>

      {!accounts.length ? (
        <Card>
          <EmptyState
            icon="accounts"
            title="Create an account first"
            description="Imported transactions need a home. Add the account you exported the statement from."
            action={
              <Button icon="plus" onClick={() => (window.location.href = '/accounts')}>
                Go to accounts
              </Button>
            }
          />
        </Card>
      ) : null}

      <div className="grid">
        <Card className="span-8" title={tab === 'csv' ? 'Import a CSV statement' : 'Import an OFX or QFX file'}>
          <div className="stack">
            <Field label="Import into account">
              <select className="input" value={accountId} onChange={(event) => setAccountId(event.target.value)}>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name} ({account.type})
                  </option>
                ))}
              </select>
            </Field>

            <div
              className={`dropzone ${dragging ? 'drag' : ''}`}
              onClick={() => inputRef.current?.click()}
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                handleFile(event.dataTransfer.files?.[0]);
              }}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') inputRef.current?.click();
              }}
            >
              <Icon name={tab === 'csv' ? 'upload' : 'file'} size={22} />
              <strong>{file ? file.name : 'Drop a file here or click to browse'}</strong>
              <span>
                {tab === 'csv'
                  ? 'Comma, semicolon or tab separated · up to 25,000 rows'
                  : 'OFX 1.x SGML and OFX 2.x / QFX XML are supported'}
              </span>
              {file ? <span className="file-pill" style={{ marginTop: 12 }}>{file.name} · {preview?.totalRows ?? '…'} rows</span> : null}
            </div>
            <input
              ref={inputRef}
              type="file"
              accept={tab === 'csv' ? '.csv,text/csv' : '.ofx,.qfx'}
              hidden
              onChange={(event) => handleFile(event.target.files?.[0])}
            />

            {error ? <InlineError>{error}</InlineError> : null}

            {tab === 'csv' && preview ? (
              <>
                <div className="hr" />
                <div className="section-title" style={{ margin: 0 }}>
                  <div>
                    <h2>Column mapping</h2>
                    <p>Cove guessed these from the header row. Adjust anything that looks off.</p>
                  </div>
                  <Badge color="var(--accent)">{preview.totalRows} rows</Badge>
                </div>

                <div className="mapping-grid">
                  {MAPPING_FIELDS.filter((field) => {
                    if (field.key === 'debit' || field.key === 'credit') return amountMode === 'debit_credit';
                    if (field.key === 'amount') return amountMode !== 'debit_credit';
                    return true;
                  }).map((field) => (
                    <Field key={field.key} label={field.label}>
                      <select
                        className="input input-sm"
                        value={mapping[field.key] || ''}
                        onChange={(event) => setMapping({ ...mapping, [field.key]: event.target.value })}
                      >
                        <option value="">Not used</option>
                        {preview.headers.map((header) => (
                          <option key={header} value={header}>
                            {header}
                          </option>
                        ))}
                      </select>
                    </Field>
                  ))}
                  <Field label="Amount style">
                    <select
                      className="input input-sm"
                      value={amountMode}
                      onChange={(event) => setMapping({ ...mapping, amountMode: event.target.value })}
                    >
                      <option value="signed">Signed (negative = money out)</option>
                      <option value="positive_expense">Positive means spending</option>
                      <option value="debit_credit">Separate debit & credit</option>
                    </select>
                  </Field>
                  <Field label="Date format">
                    <select
                      className="input input-sm"
                      value={mapping.dateFormat}
                      onChange={(event) => setMapping({ ...mapping, dateFormat: event.target.value })}
                    >
                      <option value="auto">Auto-detect</option>
                      <option value="MM/DD/YYYY">MM/DD/YYYY</option>
                      <option value="DD/MM/YYYY">DD/MM/YYYY</option>
                    </select>
                  </Field>
                </div>

                <div className="table-wrap" style={{ border: '1px solid var(--border)', borderRadius: 10 }}>
                  <table className="data preview-table">
                    <thead>
                      <tr>
                        {preview.headers.map((header) => (
                          <th key={header}>{header}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {preview.sample.map((row, index) => (
                        <tr key={index}>
                          {row.map((cell, cellIndex) => (
                            <td key={cellIndex}>{cell}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="form-row" style={{ justifyContent: 'flex-end' }}>
                  <Button variant="subtle" onClick={reset}>
                    Choose another file
                  </Button>
                  <Button
                    icon="upload"
                    onClick={runCsvImport}
                    loading={busy}
                    disabled={!mapping.date || !mapping.description}
                  >
                    Import {preview.totalRows} rows
                  </Button>
                </div>
              </>
            ) : null}

            {tab === 'ofx' && file ? (
              <div className="form-row" style={{ justifyContent: 'flex-end' }}>
                <Button variant="subtle" onClick={reset}>
                  Choose another file
                </Button>
                <Button icon="upload" onClick={runOfxImport} loading={busy}>
                  Import statement
                </Button>
              </div>
            ) : null}

            {result ? (
              <div className="stack-sm">
                <div className="hr" />
                <div className="notice notice-success">
                  <Icon name="check" size={16} />
                  <span>
                    Imported {result.imported} transactions into {result.accountName}.
                    {result.meta?.startDate ? ` Statement covers ${formatDate(result.meta.startDate)} – ${formatDate(result.meta.endDate)}.` : ''}
                  </span>
                </div>
                <div className="result-grid">
                  <div className="result-stat">
                    <strong>{result.imported}</strong>
                    <span>Imported</span>
                  </div>
                  <div className="result-stat">
                    <strong>{result.duplicates}</strong>
                    <span>Duplicates skipped</span>
                  </div>
                  <div className="result-stat">
                    <strong>{result.failed}</strong>
                    <span>Rows failed</span>
                  </div>
                </div>
                {result.errors?.length ? (
                  <details>
                    <summary className="dim" style={{ cursor: 'pointer', fontSize: 12 }}>
                      Show {result.errors.length} row errors
                    </summary>
                    <ul className="error-list">
                      {result.errors.map((message) => (
                        <li key={message}>{message}</li>
                      ))}
                    </ul>
                  </details>
                ) : null}
                {result.warnings?.length ? (
                  <details>
                    <summary className="dim" style={{ cursor: 'pointer', fontSize: 12 }}>
                      Show {result.warnings.length} warnings
                    </summary>
                    <ul className="error-list">
                      {result.warnings.map((message) => (
                        <li key={message}>{message}</li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </div>
            ) : null}
          </div>
        </Card>

        <div className="span-4 stack">
          <Card title="Good to know">
            <div className="stack-sm tip-list">
              <div className="tip">
                <Icon name="check" size={16} />
                <p>Re-importing the same file is safe — duplicates are detected automatically.</p>
              </div>
              <div className="tip">
                <Icon name="transactions" size={16} />
                <p>Rows are categorized by merchant rules as they come in. Fix any misses in Transactions.</p>
              </div>
              <div className="tip">
                <Icon name="shield" size={16} />
                <p>Files are parsed in memory on your server. Nothing is uploaded anywhere else.</p>
              </div>
            </div>
          </Card>

          <Card title="Recent imports" flush>
            {history.length ? (
              <div style={{ padding: '4px 0' }}>
                {history.slice(0, 6).map((batch) => (
                  <div className="import-history" key={batch.id}>
                    <Icon name={batch.format === 'csv' ? 'file' : 'upload'} size={15} />
                    <div className="token-main">
                      <div className="token-name">{batch.filename || `${batch.format.toUpperCase()} import`}</div>
                      <div className="token-meta">
                        {batch.imported} imported · {batch.duplicates} skipped
                      </div>
                    </div>
                    <span className="dim" style={{ fontSize: 10.5 }}>
                      {formatDate(batch.created_at.slice(0, 10))}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState compact icon="import" title="No imports yet" description="Your import history will appear here." />
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
