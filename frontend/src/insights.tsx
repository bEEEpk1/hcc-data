import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { type AuditEvent, type IngestFailure, type Params, type Statistics } from './api';
import { AuditTable } from './audit';
import { useData, useSession } from './session';
import { Chip, CopyValue, date, Empty, Page, period, Result, values } from './ui';

export function Overview() {
  const { access } = useSession();
  const health = useData<{ status: string }>('/actuator/health');
  const audit = useData<AuditEvent[]>('/api/audit', { limit: 6 }, access.audit);
  return <Page section="РАБОЧАЯ ОБЛАСТЬ" title="Обзор DATA" description="Состояние API и последние поступления журнала.">
    <div className="overview-grid">
      <section className="panel shortcut"><h2>Состояние DATA API</h2>
        <Result loading={health.isPending} error={health.error} retry={() => void health.refetch()}>
          <Chip tone={health.data?.status === 'UP' ? 'green' : 'red'}>{health.data?.status === 'UP' ? 'Доступен' : health.data?.status ?? 'Неизвестно'}</Chip>
        </Result>
      </section>
      {access.recovery && <section className="panel shortcut"><h2>Резервный контур</h2>
        <Link className="button" to="/reserve">Резервные записи →</Link>
        <Link className="button" to="/reconcile">Открыть сверку →</Link></section>}
    </div>
    {access.audit && <section className="panel"><div className="panel-head"><div><h2>Недавние поступления CORE</h2>
      <p>Последние записи, полученные DATA</p></div><Link className="button" to="/audit">В журнал →</Link></div>
      <Result loading={audit.isPending} error={audit.error} retry={() => void audit.refetch()}>
        {audit.data?.length ? <AuditTable events={audit.data} /> : <Empty title="Пока нет событий CORE" />}
      </Result>
    </section>}
  </Page>;
}

export function StatsPage() {
  const [search, setSearch] = useState<{ path: string; params: Params } | null>(null);
  const [error, setError] = useState('');
  const data = useData<Statistics>(search?.path ?? '', search?.params, search !== null);
  const groups = data.data?.by_action?.map(row => ({ name: row.action, count: row.count })) ??
    data.data?.by_type.map(row => ({ name: row.event_type, count: row.count })) ?? [];
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = values(event);
    if (!form.id) { setError('Введите идентификатор.'); return; }
    try {
      setSearch({ path: `/api/statistics/${form.group}/${encodeURIComponent(form.id)}`, params: period(form.from, form.to) });
      setError('');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Проверьте период.');
    }
  }
  return <Page section="АНАЛИЗ" title="Статистика" description="Агрегации событий CORE по исполнителю или рейсу.">
    <section className="panel form-panel"><form onSubmit={submit}>
      <div className="filter-grid">
        <label>Группировка<select name="group"><option value="actors">Исполнитель</option><option value="flights">Рейс</option></select></label>
        <label>Идентификатор<input name="id" required maxLength={256} /></label>
        <label>С (местное время)<input type="datetime-local" name="from" /></label>
        <label>По (местное время)<input type="datetime-local" name="to" /></label>
      </div>
      {error && <p className="error-text" role="alert">{error}</p>}
      <button className="button primary">Получить статистику</button>
    </form></section>
    <section className="panel">
      <div className="panel-head"><div><h2>Распределение событий</h2>{data.data && <p>{data.data.id}</p>}</div>
        {data.data && <Chip tone="green">Всего: {data.data.total_events}</Chip>}</div>
      {!search ? <Empty title="Укажите исполнителя или рейс" /> :
        <Result loading={data.isPending} error={data.error} retry={() => void data.refetch()}>
          {groups.length ? <div className="table-scroll"><table><thead><tr><th>{data.data?.by_action ? 'Действие' : 'Тип события'}</th>
            <th>Доля</th><th>Количество</th></tr></thead>
            <tbody>{groups.map(row => <tr key={row.name}><td>{row.name}</td><td className="bar-cell">
              <meter value={row.count} max={data.data?.total_events || 1} aria-label={`Доля событий ${row.name}`} /></td>
              <td>{row.count}</td></tr>)}</tbody></table></div> : <Empty title="За выбранный период событий нет" />}
        </Result>}
    </section>
  </Page>;
}

export function DiagnosticsPage() {
  const [limit, setLimit] = useState(100);
  const data = useData<IngestFailure[]>('/api/ingest-failures', { limit });
  return <Page section="СОСТОЯНИЕ ПРИЁМА" title="Диагностика" description="Причины отклонения сообщений и их позиции в Kafka."
    actions={<button className="button" disabled={data.isFetching} onClick={() => void data.refetch()}>↻ Обновить</button>}>
    <section className="panel"><div className="panel-head"><div><h2>Ошибки приёма</h2><p>Последние зарегистрированные отказы · UTC</p></div>
      <label className="inline-label">Лимит<select value={limit} onChange={event => setLimit(Number(event.target.value))}>
        {[25, 100, 250, 500].map(value => <option key={value}>{value}</option>)}</select></label></div>
      <Result loading={data.isPending} error={data.error} retry={() => void data.refetch()}>
        {data.data?.length ? <div className="table-scroll"><table><thead><tr><th>Получено · UTC</th><th>Причина</th><th>Топик</th>
          <th>Раздел</th><th>Смещение</th><th>ID отказа</th><th>SHA-256</th></tr></thead>
          <tbody>{data.data.map(row => <tr key={row.failure_id}><td className="nowrap">{date(row.received_at)}</td>
            <td><Chip tone="red">{row.reason_code}</Chip></td><td>{row.topic}</td><td>{row.partition_no}</td>
            <td>{row.offset_no}</td><td><CopyValue value={row.failure_id} compact /></td>
            <td><CopyValue value={row.content_sha256} compact /></td></tr>)}</tbody></table></div>
          : <Empty title="Ошибки приёма не зарегистрированы" />}
      </Result>
    </section>
  </Page>;
}
