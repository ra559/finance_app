import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import Icon from './icons.jsx';
import { useApp } from './state.jsx';
import { currentMonthKey, formatMoney, formatPercent, monthLabel, shiftMonth } from './format.js';

export function Money({ cents, className = '', compact = false, alwaysSign = false, decimals }) {
  const app = useApp();
  const currency = app?.prefs?.currency || 'USD';
  return (
    <span className={`num ${className}`}>
      {formatMoney(cents, currency, { compact, alwaysSign, decimals })}
    </span>
  );
}

export function PageHeader({ title, subtitle, children }) {
  return (
    <header className="page-head">
      <div>
        <h1>{title}</h1>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      {children ? <div className="page-actions">{children}</div> : null}
    </header>
  );
}

export function Card({ title, subtitle, actions, children, className = '', bodyClassName = '', flush = false }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="card-head">
          <div>
            {title ? <h2>{title}</h2> : null}
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          {actions ? <div className="card-actions">{actions}</div> : null}
        </header>
      )}
      <div className={`${flush ? '' : 'card-body'} ${bodyClassName}`}>{children}</div>
    </section>
  );
}

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  icon,
  loading = false,
  className = '',
  type = 'button',
  ...props
}) {
  return (
    <button type={type} className={`btn btn-${variant} btn-${size} ${className}`} disabled={loading || props.disabled} {...props}>
      {loading ? <span className="spinner spinner-sm" /> : icon ? <Icon name={icon} size={16} /> : null}
      <span>{children}</span>
    </button>
  );
}

export function IconButton({ icon, label, className = '', size = 17, ...props }) {
  return (
    <button type="button" className={`icon-btn ${className}`} aria-label={label} title={label} {...props}>
      <Icon name={icon} size={size} />
    </button>
  );
}

export function Field({ label, hint, children, className = '', htmlFor }) {
  return (
    <label className={`field ${className}`} htmlFor={htmlFor}>
      {label ? <span className="field-label">{label}</span> : null}
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

export function Modal({ open, title, subtitle, onClose, children, footer, wide = false }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="modal-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-head">
          <div>
            <h2>{title}</h2>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <IconButton icon="x" label="Close" onClick={onClose} />
        </header>
        <div className="modal-body">{children}</div>
        {footer ? <footer className="modal-foot">{footer}</footer> : null}
      </div>
    </div>,
    document.body,
  );
}

export function Progress({ value, color = 'var(--accent)', height = 8, over = false }) {
  const percent = value === null || value === undefined ? 0 : Math.max(0, Math.min(value, 1));
  return (
    <div className="progress" style={{ height }}>
      <span
        className={`progress-fill ${over ? 'over' : ''}`}
        style={{ width: `${percent * 100}%`, background: over ? 'var(--negative)' : color }}
      />
    </div>
  );
}

export function Badge({ children, color = 'var(--text-2)', soft = true, className = '' }) {
  return (
    <span
      className={`badge ${soft ? 'badge-soft' : ''} ${className}`}
      style={{ '--badge-color': color }}
    >
      {children}
    </span>
  );
}

export function Delta({ value, percent, invertGood = false }) {
  if (percent === null || percent === undefined) return <span className="delta muted">—</span>;
  const positive = percent >= 0;
  const good = invertGood ? !positive : positive;
  return (
    <span className={`delta ${good ? 'pos' : 'neg'}`}>
      {positive ? '↑' : '↓'} {formatPercent(Math.abs(percent), 1)}
      {value !== undefined && value !== null ? <span className="delta-sub"> vs last month</span> : null}
    </span>
  );
}

export function EmptyState({ icon = 'spark', title, description, action, compact = false }) {
  return (
    <div className={`empty ${compact ? 'empty-compact' : ''}`}>
      <span className="empty-icon">
        <Icon name={icon} size={22} />
      </span>
      <h3>{title}</h3>
      {description ? <p>{description}</p> : null}
      {action}
    </div>
  );
}

export function Spinner({ size = 'md' }) {
  return <span className={`spinner spinner-${size}`} />;
}

export function Loading({ rows = 3, height = 84 }) {
  return (
    <div className="skeleton-stack">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="skeleton" style={{ height }} />
      ))}
    </div>
  );
}

export function MonthSwitcher({ month, onChange }) {
  const isCurrent = month === currentMonthKey();
  return (
    <div className="month-switcher">
      <IconButton icon="chevronLeft" label="Previous month" onClick={() => onChange(shiftMonth(month, -1))} size={16} />
      <span className="month-label">{monthLabel(month)}</span>
      <IconButton
        icon="chevronRight"
        label="Next month"
        onClick={() => onChange(shiftMonth(month, 1))}
        size={16}
        disabled={isCurrent}
      />
    </div>
  );
}

export function CategoryDot({ color, size = 8 }) {
  return <span className="cat-dot" style={{ background: color || 'var(--text-3)', width: size, height: size }} />;
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          role="tab"
          aria-selected={value === tab.value}
          className={`tab ${value === tab.value ? 'active' : ''}`}
          onClick={() => onChange(tab.value)}
        >
          {tab.icon ? <Icon name={tab.icon} size={15} /> : null}
          {tab.label}
        </button>
      ))}
    </div>
  );
}

export function InlineError({ children }) {
  if (!children) return null;
  return (
    <div className="inline-error">
      <Icon name="alert" size={16} />
      <span>{children}</span>
    </div>
  );
}

export function CopyButton({ value, label = 'Copy', onCopied }) {
  return (
    <Button
      variant="subtle"
      size="sm"
      icon="copy"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          onCopied?.('Copied to clipboard');
        } catch {
          onCopied?.('Copy failed — select the text instead');
        }
      }}
    >
      {label}
    </Button>
  );
}
