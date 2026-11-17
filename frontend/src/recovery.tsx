import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  actionOf, object, type AuditEvent, type Classification, type Decision,
  type ReconcileRequest, type Reserve, type ReserveDetail, type ReserveRequest,
} from './api';
import { useData, useSession, useWrite } from './session';
import { AuditFacts, Chip, CopyValue, date, Empty, Facts, inputTime, iso, JsonPanel, Modal, Page, Result, values } from './ui';

const reservePath = '/api/reserve-records';
const sourceLabels = { PHONE: 'Телефон', BACKUP_JOURNAL: 'Резервный журнал' };
const classifications: Record<Classification, string> = {
  UNIQUE: 'Уникальная запись', DUPLICATE: 'Дубликат', CONFLICT: 'Расхождение',
};
const decisions: Record<Decision, string> = {
  MARK_DUPLICATE: 'Отметить дубликат', REQUEST_CORE_REVIEW: 'Зафиксировать запрос на проверку CORE',
  REJECT: 'Отклонить', ESCALATE: 'Зафиксировать эскалацию',
};

export function ReserveList({ reconcile }: { reconcile: boolean }) {
  const base = reconcile ? '/reconcile' : '/reserve';
  const [search, setSearch] = useSearchParams();
  const [reset, setReset] = useState(0);
  const limit = Number(search.get('limit')) || 100;
  const data = useData<Reserve[]>(reservePath, {
    checklistId: search.get('checklistId') ?? undefined, actorId: search.get('actorId') ?? undefined, limit,
  });
  return <Page section="РЕЗЕРВНЫЙ КОНТУР" title={reconcile ? 'Сверка' : 'Резервные записи'}
    description={reconcile ? 'Выберите резервную запись и сопоставьте её с событиями CORE.' :
      'Просмотр и регистрация фактов, полученных по резервному каналу.'}
    actions={!reconcile && <Link className="button primary" to="/reserve/new">＋ Новая запись</Link>}>
    <section className="panel form-panel"><form key={`${search}:${reset}`} onSubmit={event => {
      event.preventDefault();
      setSearch(Object.entries(values(event)).filter(([, value]) => value));
    }}>
      <div className="filter-grid">
        <label>Чек-лист<input name="checklistId" defaultValue={search.get('checklistId') ?? ''} maxLength={256} /></label>
        <label>Исполнитель<input name="actorId" defaultValue={search.get('actorId') ?? ''} maxLength={256} /></label>
        <label>Лимит<select name="limit" defaultValue={limit}>{[25, 100, 250, 500].map(count => <option key={count}>{count}</option>)}</select></label>
      </div>
      <div className="buttons"><button className="button primary">Применить</button>
        <button type="button" className="button quiet" onClick={() => { setSearch({}); setReset(reset + 1); }}>Сбросить</button></div>
    </form></section>
    <section className="panel"><div className="panel-head"><div><h2>Записи</h2><p>Последние по времени регистрации · UTC</p></div>
      <button className="button" disabled={data.isFetching} onClick={() => void data.refetch()}>↻ Обновить</button></div>
      <Result loading={data.isPending} error={data.error} retry={() => void data.refetch()}>
        {data.data?.length ? <div className="table-scroll"><table>
          <thead><tr><th>Зарегистрировано</th><th>Фактическое время</th><th>Действие</th><th>Источник</th><th>Исполнитель</th>
            <th>Чек-лист / пункт</th><th><span className="sr-only">Действия</span></th></tr></thead>
          <tbody>{data.data.map(record => <tr key={record.reserve_record_id}>
            <td className="nowrap">{date(record.registered_at)}</td><td className="nowrap">{date(record.actual_time)}</td>
            <td><strong className="event-action">{record.event_type}</strong><span className="cell-note">{record.reason}</span></td>
            <td><Chip tone="amber">{sourceLabels[record.source]}</Chip></td><td><CopyValue compact value={record.actor_id} /></td>
            <td><CopyValue compact value={record.checklist_id} /><br /><CopyValue compact value={record.step_id} /></td>
            <td><Link className="button" to={`${base}/${record.reserve_record_id}`}>{reconcile ? 'К сверке' : 'Открыть'} →</Link></td>
          </tr>)}</tbody></table></div> : <Empty title="Резервных записей не найдено">Измените фильтры или обновите список.</Empty>}
      </Result>
    </section>
  </Page>;
}

export function ReserveForm({ original }: { original?: ReserveDetail }) {
  const navigate = useNavigate();
  const [source, setSource] = useState<Reserve['source']>(original?.source ?? 'PHONE');
  const [validation, setValidation] = useState('');
  const write = useWrite<ReserveRequest>(`create:${original?.reserve_record_id ?? 'new'}`, reservePath, [[reservePath]],
    result => navigate(`/reserve/${result.id}`, { replace: true, state: { saved: result.status } }));
  const initial = write.uncertain ?? original;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (write.uncertain) { void write.submit(write.uncertain); return; }
    const form = values(event);
    try {
      const data: unknown = JSON.parse(form.data || '{}');
      if (!object(data)) throw new Error('Дополнительные данные должны быть JSON-объектом.');
      const actualTime = iso(form.actual_time);
      if (!actualTime || Date.parse(actualTime) > Date.now() + 300_000) throw new Error('Укажите фактическое время. Допустимо до пяти минут вперёд.');
      if (!form.actor_id || !form.checklist_id || !form.step_id || form.reason.length < 3) {
        throw new Error('Заполните идентификаторы и укажите причину длиной от трёх символов.');
      }
      if (source === 'BACKUP_JOURNAL' && !form.source_ref) throw new Error('Укажите ссылку на резервный журнал.');
      setValidation('');
      void write.submit({
        operation_id: crypto.randomUUID(), flight_id: form.flight_id || null, checklist_id: form.checklist_id,
        step_id: form.step_id, event_type: form.event_type, actor_id: form.actor_id, source, actual_time: actualTime,
        reason: form.reason, source_ref: form.source_ref || null, data,
        corrects_reserve_record_id: original?.reserve_record_id ?? null,
      });
    } catch (failure) {
      setValidation(failure instanceof SyntaxError ? 'Исправьте синтаксис дополнительных данных JSON.' :
        failure instanceof Error ? failure.message : 'Проверьте введённые данные.');
    }
  }
  return <Page section="РЕЗЕРВНЫЙ КОНТУР" title={original ? 'Исправление резервной записи' : 'Новая резервная запись'}
    description={original ? 'Исправление сохраняется отдельной связанной записью.' : 'Зафиксируйте действие, полученное по телефону или из резервного журнала.'}
    actions={<Link className="button" to={original ? `/reserve/${original.reserve_record_id}` : '/reserve'}>← К записям</Link>}>
    <section className="panel form-panel"><form onSubmit={submit}>
      <fieldset disabled={write.busy || !!write.uncertain} className="form-grid">
        <label>Источник<select value={source} onChange={event => setSource(event.target.value as Reserve['source'])}>
          <option value="PHONE">Телефон</option><option value="BACKUP_JOURNAL">Резервный журнал</option></select></label>
        <label>Фактическое время (местное)<input type="datetime-local" name="actual_time" required defaultValue={inputTime()} /></label>
        <label>Чек-лист<input name="checklist_id" required maxLength={256} defaultValue={initial?.checklist_id} readOnly={!!original} /></label>
        <label>Пункт<input name="step_id" required maxLength={256} defaultValue={initial?.step_id} readOnly={!!original} /></label>
        <label>Исполнитель<input name="actor_id" required maxLength={256} defaultValue={initial?.actor_id} /></label>
        <label>Рейс (если известен)<input name="flight_id" maxLength={256} defaultValue={initial?.flight_id ?? ''} /></label>
        <label>Действие / тип события<input name="event_type" required pattern="[A-Za-z][A-Za-z0-9_.\-]{0,127}"
          maxLength={128} defaultValue={initial?.event_type} placeholder="STEP_COMPLETED" /></label>
        <label>Ссылка на источник{source === 'PHONE' ? ' (необязательно)' : ''}<input name="source_ref"
          required={source === 'BACKUP_JOURNAL'} maxLength={256} defaultValue={initial?.source_ref ?? ''} /></label>
        <label className="wide">Основание<textarea name="reason" required minLength={3} maxLength={2000} rows={3} defaultValue={write.uncertain?.reason} /></label>
        <label className="wide">Дополнительные данные (JSON, необязательно)
          <textarea className="mono" name="data" rows={3} spellCheck={false} defaultValue={initial ? JSON.stringify(initial.data, null, 2) : '{}'} />
        </label>
      </fieldset>
      <WriteNotice validation={validation} error={write.error} uncertain={write.uncertain?.operation_id} />
      <button className="button primary" disabled={write.busy}>
        {write.busy ? 'Отправляем…' : write.uncertain ? 'Повторить ту же операцию' : 'Сохранить запись'}</button>
    </form></section>
  </Page>;
}

function WriteNotice({ validation, error, uncertain }: { validation?: string; error: string; uncertain?: string }) {
  return <>
    {(validation || error) && <p className="notice error" role="alert">{validation || error}</p>}
    {uncertain && <div className="notice" role="status">Результат отправки неизвестен. Повтор использует прежние данные и идентификатор.
      <br /><CopyValue value={uncertain} /></div>}
  </>;
}

function ReserveFacts({ record }: { record: Reserve }) {
  return <Facts items={[
    ['ID записи', <CopyValue value={record.reserve_record_id} />], ['Operation ID', <CopyValue value={record.operation_id} />],
    ['Источник', sourceLabels[record.source]], ['Ссылка на источник', record.source_ref],
    ['Действие', record.event_type], ['Исполнитель', <CopyValue value={record.actor_id} />],
    ['Фактическое время · UTC', date(record.actual_time)], ['Зарегистрировано · UTC', date(record.registered_at)],
    ['Чек-лист', <CopyValue value={record.checklist_id} />], ['Пункт', <CopyValue value={record.step_id} />],
    ['Рейс', <CopyValue value={record.flight_id} />], ['Регистратор', record.registered_by],
    ['Основание', record.reason],
    ['Исправляет запись', record.corrects_reserve_record_id ?
      <Link to={`/reserve/${record.corrects_reserve_record_id}`}>{record.corrects_reserve_record_id}</Link> : null],
  ]} />;
}

export function ReserveDetailPage({ reconcile = false, correction = false }: { reconcile?: boolean; correction?: boolean }) {
  const { id } = useParams();
  const location = useLocation();
  const { access } = useSession();
  const path = `${reservePath}/${encodeURIComponent(id ?? '')}`;
  const data = useData<ReserveDetail>(path);
  const [saved, setSaved] = useState(false);
  const record = data.data;
  const created = object(location.state) ? location.state.saved : null;
  if (correction && record) return <ReserveForm key={record.reserve_record_id} original={record} />;
  return <Page section="РЕЗЕРВНЫЙ КОНТУР" title={reconcile ? 'Сверка записи' : 'Резервная запись'}
    actions={<Link className="button" to={reconcile ? '/reconcile' : '/reserve'}>← К списку</Link>}>
    <Result loading={data.isPending} error={data.error} retry={() => void data.refetch()}>
      {record && <>
        {created && <div className="notice success" role="status">
          {created === 'DUPLICATE' ? 'Эта операция уже сохранена.' : 'Резервная запись сохранена.'}
        </div>}
        <section className="panel detail-panel">
          <div className="panel-head"><div><h2>{record.event_type}</h2><p>Данные резервной регистрации</p></div>
            <Chip tone="amber">{sourceLabels[record.source]}</Chip></div>
          <div className="detail-content"><ReserveFacts record={record} /><JsonPanel value={record.data} />
            {!reconcile && <div className="buttons">
              <Link className="button primary" to={`/reconcile/${record.reserve_record_id}`}>К сверке →</Link>
              <Link className="button" to={`/reserve/${record.reserve_record_id}/correct`}>Создать исправление</Link>
            </div>}
          </div>
        </section>
        {saved && <div className="notice success" role="status">Решение сохранено в истории.</div>}
        {reconcile && <ReconcileForm key={record.reserve_record_id} record={record} canSearch={access.audit}
          onSaved={() => setSaved(true)} refresh={() => void data.refetch()} />}
        <History record={record} />
      </>}
    </Result>
  </Page>;
}

function History({ record }: { record: ReserveDetail }) {
  return <section className="panel"><div className="panel-head"><div><h2>История решений</h2><p>Время отображается в UTC</p></div></div>
    {record.decisions.length ? <div className="table-scroll"><table><thead><tr><th>Время</th><th>Классификация и решение</th>
      <th>Автор</th><th>Основание</th><th>Связи</th></tr></thead>
      <tbody>{[...record.decisions].reverse().map(row => <tr key={row.reconciliation_id}><td className="nowrap">{date(row.resolved_at)}</td>
        <td><strong>{classifications[row.classification]}</strong><span className="cell-note">{decisions[row.decision]}</span></td>
        <td>{row.resolved_by}</td><td>{row.reason}</td><td className="history-links">
          <span>Решение <CopyValue compact value={row.reconciliation_id} /></span>
          {row.matched_audit_id && <span>Аудит <CopyValue compact value={row.matched_audit_id} /></span>}
          {row.supersedes_id && <span>Заменяет <CopyValue compact value={row.supersedes_id} /></span>}
        </td></tr>)}</tbody></table></div> : <Empty title="Решений пока нет" />}
  </section>;
}

function ReconcileForm({ record, canSearch, onSaved, refresh }: {
  record: ReserveDetail; canSearch: boolean; onSaved: () => void; refresh: () => void;
}) {
  const path = `${reservePath}/${record.reserve_record_id}`;
  const last = record.decisions.at(-1);
  const [classification, setClassification] = useState<Classification>('UNIQUE');
  const [selected, select] = useState<AuditEvent | null>(null);
  const [showCandidates, setShowCandidates] = useState(false);
  const [offset, setOffset] = useState(0);
  const [validation, setValidation] = useState('');
  const [confirm, setConfirm] = useState<ReconcileRequest | null>(null);
  const [decision, setDecision] = useState<Decision>('REQUEST_CORE_REVIEW');
  const candidates = useData<AuditEvent[]>('/api/audit', {
    checklistId: record.checklist_id, stepId: record.step_id, limit: 10, offset,
  }, showCandidates && canSearch);
  const write = useWrite<ReconcileRequest>(path, `${path}/reconciliations`, [[path]], () => {
    setConfirm(null); select(null); onSaved();
  }, refresh);
  const sameAction = selected && actionOf(selected) === record.event_type;
  const sameActor = selected && selected.actor_id === record.actor_id;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (write.uncertain) { void write.submit(write.uncertain); return; }
    const form = values(event);
    const matchedId = classification !== 'UNIQUE' ? selected?.audit_id ?? form.matched_id : null;
    if (classification !== 'UNIQUE' && !matchedId) { setValidation('Выберите событие CORE для сравнения.'); return; }
    if (classification === 'DUPLICATE' && selected && (!sameActor || !sameAction)) {
      setValidation('Для дубликата исполнитель и действие должны совпадать.'); return;
    }
    if (form.reason.length < 3) { setValidation('Укажите основание длиной от трёх символов.'); return; }
    setValidation('');
    setConfirm({
      operation_id: crypto.randomUUID(), classification, decision, matched_audit_id: matchedId,
      reason: form.reason, supersedes_id: last?.reconciliation_id ?? null,
    });
  }

  return <section className="panel"><div className="panel-head"><div><h2>Решение по сверке</h2>
    <p>{last ? 'Новое решение будет добавлено к истории и заменит последнее.' : 'Сохраните итог сравнения в журнале DATA.'}</p></div></div>
    <div className="detail-content">
      {canSearch && !write.uncertain && <div className="candidate-area">
        <button className="button" type="button" disabled={write.busy}
          onClick={() => setShowCandidates(!showCandidates)}>{showCandidates ? 'Скрыть результаты' : 'Найти события CORE по чек-листу и пункту'}</button>
        {showCandidates && <Result loading={candidates.isPending} error={candidates.error} retry={() => void candidates.refetch()}>
          {candidates.data?.length ? <div className="candidate-list">{candidates.data.map(event =>
            <button key={event.audit_id} type="button" className={`candidate ${selected?.audit_id === event.audit_id ? 'selected' : ''}`}
              onClick={() => { select(event); if (classification === 'UNIQUE') setClassification('DUPLICATE'); }}>
              <strong>{actionOf(event)}</strong><span>{date(event.actual_time)} UTC · {event.source} · {event.actor_id || '—'}</span>
            </button>)}</div> : <Empty title="События CORE для этого пункта не найдены" />}
          <div className="buttons"><button className="button" disabled={offset === 0} onClick={() => setOffset(offset - 10)}>← Назад</button>
            <button className="button" disabled={candidates.data?.length !== 10 || offset + 10 > 100000}
              onClick={() => setOffset(offset + 10)}>Далее →</button></div>
        </Result>}
      </div>}
      {selected && <div className="comparison"><div><h3>Резервная запись</h3><p>{record.event_type}</p><p>{record.actor_id}</p>
        <p>{date(record.actual_time)} UTC · {sourceLabels[record.source]}</p></div>
        <div><h3>Событие CORE</h3><p>{actionOf(selected)} {!sameAction && <Chip tone="amber">Другое действие</Chip>}</p>
          <p>{selected.actor_id || '—'} {!sameActor && <Chip tone="amber">Другой исполнитель</Chip>}</p>
          <p>{date(selected.actual_time)} UTC · {selected.source}</p><CopyValue value={selected.audit_id} compact /></div>
        <details className="wide"><summary>Идентификаторы события CORE</summary><AuditFacts event={selected} /></details>
      </div>}
      <form onSubmit={submit}>
        <fieldset disabled={write.busy || !!write.uncertain} className="form-grid">
          <label><span id="classification-label">Классификация</span><select aria-labelledby="classification-label" value={classification} onChange={event => {
            const value = event.target.value as Classification;
            setClassification(value);
            if (value !== 'DUPLICATE' && decision === 'MARK_DUPLICATE') setDecision('REQUEST_CORE_REVIEW');
          }}>{Object.entries(classifications).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label><span id="decision-label">Решение</span><select aria-labelledby="decision-label" value={decision} onChange={event => setDecision(event.target.value as Decision)}>
            {Object.entries(decisions).filter(([value]) => value !== 'MARK_DUPLICATE' || classification === 'DUPLICATE')
              .map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></label>
          {classification !== 'UNIQUE' && !selected && <label className="wide">ID события аудита
            <input name="matched_id" required pattern="[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}" />
          </label>}
          <label className="wide">Основание<textarea name="reason" rows={3} minLength={3} maxLength={2000} required defaultValue={write.uncertain?.reason} /></label>
        </fieldset>
        <WriteNotice validation={validation} error={write.error} uncertain={write.uncertain?.operation_id} />
        <button className="button primary" disabled={write.busy}>
          {write.busy ? 'Отправляем…' : write.uncertain ? 'Повторить то же решение' : 'Проверить и подтвердить'}</button>
      </form>
    </div>
    {confirm && <Modal title="Подтвердить решение" close={() => { if (!write.busy) setConfirm(null); }}>
      <Facts items={[
        ['Классификация', classifications[confirm.classification]], ['Решение', decisions[confirm.decision]],
        ['Основание', confirm.reason], ['Событие аудита', confirm.matched_audit_id],
        ['Заменяет решение', confirm.supersedes_id],
      ]} />
      <div className="buttons"><button className="button primary" disabled={write.busy} onClick={() => {
        setConfirm(null);
        void write.submit(confirm);
      }}>Записать решение</button><button className="button" onClick={() => setConfirm(null)}>Вернуться</button></div>
    </Modal>}
  </section>;
}
