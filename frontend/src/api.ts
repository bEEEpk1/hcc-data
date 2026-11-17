export type JsonObject = Record<string, unknown>;

export type AuditEvent = {
  audit_id: string;
  source_event_id: string;
  producer_service: 'AUTH' | 'CORE';
  event_type: string;
  source: string;
  occurred_at: string;
  actual_time: string;
  received_at: string;
  payload: JsonObject;
} & Record<'correlation_id' | 'causation_id' | 'operation_id' | 'flight_id' | 'checklist_id' |
  'step_id' | 'actor_id' | 'subject_user_id' | 'registered_by', string | null>;

export type ReserveRequest = {
  operation_id: string;
  flight_id: string | null;
  checklist_id: string;
  step_id: string;
  event_type: string;
  actor_id: string;
  source: 'PHONE' | 'BACKUP_JOURNAL';
  actual_time: string;
  reason: string;
  source_ref: string | null;
  data: JsonObject;
  corrects_reserve_record_id: string | null;
};

export type Reserve = ReserveRequest & {
  reserve_record_id: string;
  registered_by: string;
  registered_at: string;
};

export type Classification = 'DUPLICATE' | 'UNIQUE' | 'CONFLICT';
export type Decision = 'MARK_DUPLICATE' | 'REQUEST_CORE_REVIEW' | 'REJECT' | 'ESCALATE';

export type ReconcileRequest = {
  operation_id: string;
  classification: Classification;
  decision: Decision;
  matched_audit_id: string | null;
  reason: string;
  supersedes_id: string | null;
};

export type Reconciliation = ReconcileRequest & {
  reconciliation_id: string;
  resolved_by: string;
  resolved_at: string;
};
export type ReserveDetail = Reserve & { decisions: Reconciliation[] };
export type ActionResult = { status: 'CREATED' | 'DUPLICATE'; id: string };
export type Statistics = {
  id: string;
  total_events: number;
  by_type: { event_type: string; count: number }[];
  by_action?: { action: string; count: number }[];
};
export type IngestFailure = {
  failure_id: string;
  topic: string;
  partition_no: number;
  offset_no: number;
  content_sha256: string;
  reason_code: string;
  received_at: string;
};

export type Params = Record<string, string | number | undefined>;

export function object(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export class ApiError extends Error {
  constructor(public status: number, public detail = '') {
    super(detail || String(status));
  }
}

export function errorText(error: unknown) {
  if (error instanceof DOMException && error.name === 'TimeoutError') return 'DATA не ответил вовремя. Повторите запрос.';
  if (!(error instanceof ApiError)) return 'Не удалось обработать ответ DATA. Попробуйте ещё раз.';
  const messages: Record<number, string> = {
    0: 'Связь с DATA прервалась. Проверьте подключение.',
    400: 'Проверьте введённые данные.',
    401: 'Токен отсутствует или недействителен. Подключитесь снова.',
    403: 'У текущего токена нет доступа к этой операции.',
    404: 'Запись не найдена.',
    409: 'Обнаружен конфликт. Обновите данные перед следующей попыткой.',
    422: 'Сервер отклонил содержимое записи.',
    500: 'Ошибка на стороне DATA.',
    502: 'Сервер DATA недоступен.',
    503: 'Сервер DATA временно недоступен.',
    504: 'Сервер DATA не ответил вовремя.',
  };
  const message = messages[error.status] || `DATA вернул ошибку HTTP ${error.status}.`;
  return error.detail && error.status >= 400 && error.status < 500 ? `${message} ${error.detail}` : message;
}

export const unconfirmed = (error: unknown) =>
  !(error instanceof ApiError) || error.status === 0 || error.status >= 500;

export async function request<T>(path: string, options: {
  token?: string; params?: Params; signal?: AbortSignal; body?: ReserveRequest | ReconcileRequest;
} = {}): Promise<T> {
  const url = new URL(path, window.location.origin);
  for (const [key, value] of Object.entries(options.params ?? {})) {
    if (value !== '' && value !== undefined) url.searchParams.set(key, String(value));
  }
  const headers = new Headers({ Accept: 'application/json' });
  if (options.token) headers.set('Authorization', `Bearer ${options.token}`);
  if (options.body) headers.set('Content-Type', 'application/json');
  let response: Response;
  try {
    response = await fetch(url, {
      headers,
      signal: options.signal,
      method: options.body ? 'POST' : 'GET',
      body: options.body ? JSON.stringify(options.body) : undefined,
      cache: 'no-store',
      redirect: 'error',
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new ApiError(0);
  }
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = object(data) && typeof data.error === 'string' ? data.error : '';
    throw new ApiError(response.status, detail);
  }
  if (data === null) throw new ApiError(502);
  return data as T;
}

export function actionOf(event: AuditEvent): string {
  const data = event.payload.data;
  return event.producer_service === 'CORE' && event.event_type === 'audit.log' &&
    object(data) && typeof data.action === 'string' && data.action !== '' ? data.action : event.event_type;
}

export function payloadText(event: AuditEvent, key: string) {
  const value = event.payload[key];
  return typeof value === 'string' ? value : null;
}
