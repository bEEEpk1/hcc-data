import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { actionOf, payloadText, type AuditEvent, type Params } from './api';
import { useData, useSession } from './session';
import { AuditFacts, Chip, CopyValue, date, Empty, JsonPanel, Modal, Page, period, Result, values } from './ui';

const fields = {
  core: [
    ['action', 'Действие'], ['eventType', 'Тип события'], ['actorId', 'Исполнитель'],
    ['checklistId', 'Чек-лист'], ['stepId', 'Пункт'], ['flightId', 'Рейс'],
  ],
  security: [['eventType', 'Тип события'], ['actorId', 'Исполнитель'], ['subjectUserId', 'Пользователь AUTH']],
};
const pageSize = 25;

export function AuditPage({ security }: { security: boolean }) {
  const { access } = useSession();
  const [query, setQuery] = useSearchParams();
  const [selected, select] = useState<AuditEvent | null>(null);
  const [validation, setValidation] = useState('');
  const [reset, setReset] = useState(0);
  const filterFields = fields[security ? 'security' : 'core'];
  const offset = Math.max(0, Math.min(100000, Number.parseInt(query.get('offset') ?? '', 10) || 0));
  const params: Params = { offset, limit: pageSize };
  for (const [key] of filterFields) params[key] = query.get(key) || undefined;
  try {
    Object.assign(params, period(query.get('from') ?? '', query.get('to') ?? ''));
  } catch {
    // A malformed shared URL can still be corrected using the filter form.
  }
  const data = useData<AuditEvent[]>(security ? '/api/audit/security' : '/api/audit', params);
  const filterKey = JSON.stringify([...query].filter(([key]) => key !== 'offset'));

  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = values(event);
    try {
      period(form.from, form.to);
      setQuery(Object.entries(form).filter(([, value]) => value !== ''));
      setValidation('');
    } catch (error) {
      setValidation(error instanceof Error ? error.message : 'Проверьте период.');
    }
  }

  function go(next: number) {
    const updated = new URLSearchParams(query);
    if (next > 0) updated.set('offset', String(next));
    else updated.delete('offset');
    select(null);
    setQuery(updated);
  }

  return <Page section="ИСТОРИЯ СОБЫТИЙ" title={security ? 'Журнал безопасности' : 'Журнал аудита'}
    description={security ? 'События доступа и управления учётными записями AUTH.' : 'Поиск и просмотр событий, зарегистрированных подсистемой DATA.'}
    actions={<button className="button" disabled={data.isFetching} onClick={() => void data.refetch()}>↻ Обновить</button>}>
    {access.audit && access.security && <nav className="tabs" aria-label="Журналы">
      <Link className={!security ? 'active' : ''} to="/audit">События CORE</Link>
      <Link className={security ? 'active' : ''} to="/audit/security">Безопасность AUTH</Link>
    </nav>}
    <details className="panel filters" open>
      <summary>Фильтры <span>{[...query.keys()].filter(key => key !== 'offset').length || ''}</span></summary>
      <form key={`${filterKey}:${reset}`} onSubmit={apply}>
        <div className="filter-grid">
          {filterFields.map(([key, label]) => <label key={key}>{label}
            <input name={key} maxLength={256} defaultValue={query.get(key) ?? ''} placeholder={key === 'action' ? 'Например, CHECKLIST_CREATED' : undefined} />
          </label>)}
          <label>С (местное время)<input name="from" type="datetime-local" defaultValue={query.get('from') ?? ''} /></label>
          <label>По (местное время)<input name="to" type="datetime-local" defaultValue={query.get('to') ?? ''} /></label>
        </div>
        {validation && <p className="error-text" role="alert">{validation}</p>}
        <div className="buttons"><button className="button primary">Применить</button>
          <button className="button quiet" type="button" onClick={() => { setValidation(''); setQuery({}); setReset(reset + 1); }}>Сбросить</button></div>
      </form>
    </details>
    <section className="panel">
      <div className="panel-head"><div><h2>События {security ? 'AUTH' : 'CORE'}</h2><p>Время отображается в UTC</p></div>
        <Chip tone={security ? 'amber' : 'green'}>{security ? 'AUTH' : 'CORE'}</Chip></div>
      <Result loading={data.isPending} error={data.error} retry={() => void data.refetch()}>
        {!data.data?.length ? <Empty title={offset ? 'На этой странице нет событий' : 'Событий не найдено'}>
          {offset ? 'Вернитесь на предыдущую страницу.' : 'Измените фильтры или обновите журнал.'}</Empty>
          : <AuditTable events={data.data} security={security} select={select} />}
      </Result>
      <div className="pagination">
        <span>{data.data?.length ? `${offset + 1}–${offset + data.data.length}` : '—'}</span>
        <div className="buttons"><button className="button" disabled={!offset || data.isFetching} onClick={() => go(offset - pageSize)}>← Назад</button>
          <button className="button" disabled={data.data?.length !== pageSize || offset + pageSize > 100000 || data.isFetching}
            onClick={() => go(offset + pageSize)}>Далее →</button></div>
      </div>
    </section>
    {selected && <Modal title="Событие аудита" close={() => select(null)}>
      <div className="detail-title"><Chip tone="green">{selected.producer_service}</Chip><h3>{actionOf(selected)}</h3>
        {selected.event_type !== actionOf(selected) && <Chip>{selected.event_type}</Chip>}
        {payloadText(selected, 'message') && <p>{payloadText(selected, 'message')}</p>}
      </div>
      <AuditFacts event={selected} /><JsonPanel value={selected.payload} title="Исходный payload" />
    </Modal>}
  </Page>;
}

export function AuditTable({ events, security = false, select }: {
  events: AuditEvent[]; security?: boolean; select?: (event: AuditEvent) => void;
}) {
  return <div className="table-scroll"><table>
    <thead><tr><th>Время · UTC</th><th>Действие / событие</th><th>Источник</th><th>Исполнитель</th>
      <th>{security ? 'Пользователь AUTH' : 'Чек-лист'}</th>{select && <th><span className="sr-only">Детали</span></th>}</tr></thead>
    <tbody>{events.map(event => <tr key={event.audit_id}>
      <td className="nowrap">{date(event.occurred_at)}</td>
      <td><strong className="event-action">{actionOf(event)}</strong>
        {(payloadText(event, 'message') || payloadText(event, 'level')) && <span className="cell-note">
          {[payloadText(event, 'level'), payloadText(event, 'message')].filter(Boolean).join(' · ')}</span>}</td>
      <td><Chip>{event.source}</Chip></td><td><CopyValue value={event.actor_id} compact /></td>
      <td><CopyValue value={security ? event.subject_user_id : event.checklist_id} compact /></td>
      {select && <td><button className="button icon" onClick={() => select(event)} aria-label={`Открыть событие ${event.audit_id}`}>↗</button></td>}
    </tr>)}</tbody>
  </table></div>;
}
