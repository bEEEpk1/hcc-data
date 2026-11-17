import { createContext, useContext, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import {
  ApiError, errorText, request, unconfirmed, type ActionResult, type Params,
  type ReconcileRequest, type ReserveRequest,
} from './api';

type Body = ReserveRequest | ReconcileRequest;
type Session = {
  token: string;
  access: { audit: boolean; recovery: boolean; security: boolean };
  pending: Map<string, Body>;
  logout: () => void;
};

const SessionContext = createContext<Session | null>(null);

export function useSession() {
  const session = useContext(SessionContext);
  if (!session) throw new Error('Session required');
  return session;
}

export function useData<T>(path: string, params?: Params, enabled = true) {
  const { token } = useSession();
  return useQuery({
    queryKey: [path, params ?? {}],
    queryFn: ({ signal }) => request<T>(path, { token, params, signal }),
    enabled,
    staleTime: 15_000,
    retry: false,
    refetchOnWindowFocus: false,
  });
}

export function useWrite<T extends Body>(scope: string, path: string, invalidate: QueryKey[],
  onSuccess: (result: ActionResult) => void, onConflict?: () => void) {
  const { token, pending } = useSession();
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState<T | null>(() => (pending.get(scope) as T | undefined) ?? null);
  const [error, setError] = useState('');
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);

  async function submit(body: T) {
    if (busy) return;
    const previous = pending.get(scope) as T | undefined;
    const payload = previous ?? body;
    pending.set(scope, payload);
    setBusy(true);
    setError('');
    try {
      const result = await request<ActionResult>(path, { token, body: payload, signal: AbortSignal.timeout(15_000) });
      if (!['CREATED', 'DUPLICATE'].includes(result.status) || typeof result.id !== 'string') {
        throw new ApiError(502);
      }
      pending.delete(scope);
      for (const queryKey of invalidate) void client.invalidateQueries({ queryKey });
      if (active.current) {
        setUncertain(null);
        onSuccess(result);
      }
    } catch (failure) {
      // A failed retry cannot establish whether the first attempt committed,
      // except when DATA explicitly reports a conflict or returns its result.
      const conflict = failure instanceof ApiError && failure.status === 409;
      const preserve = unconfirmed(failure) || (previous !== undefined && !conflict);
      if (!preserve) pending.delete(scope);
      if (active.current) {
        setUncertain(preserve ? payload : null);
        setError(errorText(failure));
        if (conflict) onConflict?.();
      }
    } finally {
      if (active.current) setBusy(false);
    }
  }

  return { submit, error, busy, uncertain };
}

export function SessionGate({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const [session, setSession] = useState<Omit<Session, 'logout'> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  function logout() {
    setSession(null);
    client.clear();
  }

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const token = String(new FormData(form).get('token') ?? '').trim();
    if (!token || /\s/.test(token)) {
      setError('Введите действующий Bearer-токен без пробелов.');
      return;
    }
    setError('');
    setBusy(true);
    try {
      const check = async (path: string) => {
        try {
          const data = await request<unknown>(path, { token, params: { limit: 1 }, signal: AbortSignal.timeout(8_000) });
          if (!Array.isArray(data)) throw new ApiError(502);
          return true;
        } catch (failure) {
          if (failure instanceof ApiError && [401, 403].includes(failure.status)) return false;
          throw failure;
        }
      };
      const [audit, recovery, security] = await Promise.all([
        check('/api/audit'), check('/api/reserve-records'), check('/api/audit/security'),
      ]);
      if (!audit && !recovery && !security) {
        setError('Токен недействителен или не даёт доступа к журналам и резервным записям.');
        return;
      }
      form.reset();
      setSession({ token, access: { audit, recovery, security }, pending: new Map() });
    } catch (failure) {
      setError(failure instanceof DOMException && failure.name === 'TimeoutError'
        ? 'DATA не ответил вовремя. Повторите подключение.' : errorText(failure));
    } finally {
      setBusy(false);
    }
  }

  if (session) return <SessionContext.Provider value={{ ...session, logout }}>{children}</SessionContext.Provider>;
  return <main className="login">
    <section className="login-brand"><Brand /><p>Журнал событий наземной<br />подготовки воздушных судов</p></section>
    <section className="login-main"><form onSubmit={login} className="login-card">
      <div className="eyebrow">АУДИТ И СВЕРКА</div>
      <h1>Подключение к DATA</h1>
      <p>Введите Bearer-токен, выданный для доступа к подсистеме DATA.</p>
      <label>Bearer-токен<input name="token" type="password" required autoComplete="off" spellCheck={false}
        placeholder="Введите токен" disabled={busy} /></label>
      {error && <div role="alert" className="notice error">{error}</div>}
      <button className="button primary" disabled={busy}>{busy ? 'Подключаемся…' : 'Подключиться'}</button>
      <small>Токен хранится в памяти вкладки до выхода или перезагрузки.</small>
    </form></section>
  </main>;
}

export function Brand() {
  return <div className="brand"><div className="brand-mark" aria-hidden="true">▥</div>
    <div><strong>HCC DATA</strong><span>AUDIT LOGGER</span></div></div>;
}
