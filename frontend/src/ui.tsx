import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ApiError, errorText, object, payloadText, type AuditEvent } from './api';
import { useSession } from './session';

const time = new Intl.DateTimeFormat('ru-RU', {
  dateStyle: 'short', timeStyle: 'medium', timeZone: 'UTC',
});

export function date(value?: string | null) {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '—' : time.format(parsed);
}

export function iso(value: string) {
  return value ? new Date(value).toISOString() : undefined;
}

export function period(from: string, to: string) {
  if (from && to && from > to) throw new Error('Начало периода должно быть раньше окончания.');
  return { from: iso(from), to: iso(to) };
}

export function values(event: FormEvent<HTMLFormElement>) {
  return Object.fromEntries([...new FormData(event.currentTarget)].map(([key, value]) => [key, String(value).trim()]));
}

export function inputTime() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function Page({ section, title, description, actions, children }: {
  section: string; title: string; description?: string; actions?: ReactNode; children: ReactNode;
}) {
  return <>
    <header className="page-header"><div><div className="eyebrow">{section}</div><h1>{title}</h1>
      {description && <p>{description}</p>}</div>{actions && <div className="page-actions">{actions}</div>}</header>
    {children}
  </>;
}

export function Result({ loading, error, retry, children }: {
  loading?: boolean; error?: unknown; retry?: () => void; children?: ReactNode;
}) {
  const { logout } = useSession();
  if (loading) return <div className="state" role="status"><span className="spinner" /> Загрузка данных…</div>;
  if (error) return <div className="state error-text" role="alert">
    <p>{errorText(error)}</p>
    <div className="buttons">
      {retry && <button className="button" onClick={retry}>Повторить запрос</button>}
      {error instanceof ApiError && [401, 403].includes(error.status) &&
        <button className="button" onClick={logout}>Сменить токен</button>}
    </div>
  </div>;
  return <>{children}</>;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="state"><strong>{title}</strong>{children && <p>{children}</p>}</div>;
}

export function Chip({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'green' | 'amber' | 'red' }) {
  return <span className={`chip ${tone}`}>{children}</span>;
}

export function CopyValue({ value, compact = false }: { value?: string | null; compact?: boolean }) {
  const [status, setStatus] = useState('');
  if (!value) return <>—</>;
  async function copy() {
    try {
      await navigator.clipboard.writeText(value!);
      setStatus('Скопировано');
    } catch {
      setStatus('Копирование недоступно');
    }
  }
  return <button type="button" className="copy mono" onClick={() => void copy()} title={`${status || 'Скопировать'} · ${value}`}
    aria-label={`Скопировать: ${value}`}>
    {compact && value.length > 24 ? `${value.slice(0, 11)}…${value.slice(-5)}` : value}
    <span className="copy-mark" aria-hidden="true">{status === 'Скопировано' ? '✓' : '⧉'}</span>
    <span className="sr-only" role="status">{status}</span>
  </button>;
}

export function Facts({ items }: { items: [string, ReactNode][] }) {
  return <dl className="facts">{items.map(([label, content]) =>
    <div key={label}><dt>{label}</dt><dd>{content ?? '—'}</dd></div>)}</dl>;
}

export function JsonPanel({ value, title = 'JSON данных' }: { value: unknown; title?: string }) {
  return <details className="json-panel"><summary>{title}</summary><pre>{JSON.stringify(value, null, 2)}</pre></details>;
}

export function Modal({ title, close, children }: { title: string; close: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return <dialog className="modal" ref={dialog} aria-label={title} onCancel={event => { event.preventDefault(); close(); }}>
    <header><h2>{title}</h2><button className="button icon" type="button" aria-label="Закрыть" onClick={close}>×</button></header>
    <div className="modal-body">{children}</div>
  </dialog>;
}

export function AuditFacts({ event }: { event: AuditEvent }) {
  const data = event.payload.data;
  const responsible = object(data) && typeof data.responsibleUserId === 'string' ? data.responsibleUserId : null;
  return <Facts items={[
    ['ID аудита', <CopyValue value={event.audit_id} />], ['ID события', <CopyValue value={event.source_event_id} />],
    ['Время события · UTC', date(event.occurred_at)], ['Фактическое время · UTC', date(event.actual_time)],
    ['Получено · UTC', date(event.received_at)], ['Сервис / источник', `${event.producer_service} / ${event.source}`],
    ['Исполнитель', <CopyValue value={event.actor_id} />], ['Ответственный', <CopyValue value={responsible} />],
    ['Компонент источника', payloadText(event, 'source')], ['Пользователь AUTH', <CopyValue value={event.subject_user_id} />],
    ['Чек-лист', <CopyValue value={event.checklist_id} />], ['Пункт', <CopyValue value={event.step_id} />],
    ['Рейс', <CopyValue value={event.flight_id} />], ['Регистратор', <CopyValue value={event.registered_by} />],
    ['Correlation ID', <CopyValue value={event.correlation_id} />], ['Causation ID', <CopyValue value={event.causation_id} />],
    ['Operation ID', <CopyValue value={event.operation_id} />],
  ]} />;
}
