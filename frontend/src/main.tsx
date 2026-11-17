import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, NavLink, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuditPage } from './audit';
import { DiagnosticsPage, Overview, StatsPage } from './insights';
import { ReserveDetailPage, ReserveForm, ReserveList } from './recovery';
import { Brand, SessionGate, useSession } from './session';
import { Empty } from './ui';
import './style.css';

const client = new QueryClient();
const nav = [
  { to: '/overview', title: 'Обзор', mark: '◫' },
  { to: '/audit', title: 'Журнал аудита', mark: '▤' },
  { to: '/reserve', title: 'Резервные записи', mark: '▧' },
  { to: '/reconcile', title: 'Сверка', mark: '⇄' },
  { to: '/statistics', title: 'Статистика', mark: '◩' },
  { to: '/diagnostics', title: 'Диагностика', mark: '◇' },
];

function Workspace() {
  const { access, logout } = useSession();
  const home = access.audit ? '/audit' : access.security ? '/audit/security' : '/reserve';
  return <div className="workspace">
    <a href="#workspace-content" className="skip-link">К содержимому</a>
    <aside className="sidebar">
      <Brand />
      <nav aria-label="Основная навигация">
        {nav.filter(item =>
          item.to === '/overview' || (item.to === '/audit' && (access.audit || access.security)) ||
          (['/reserve', '/reconcile'].includes(item.to) && access.recovery) ||
          (item.to === '/statistics' && access.audit) || (item.to === '/diagnostics' && access.security)
        ).map(item => <NavLink key={item.to} to={item.to === '/audit' && !access.audit ? '/audit/security' : item.to}>
          <span aria-hidden="true">{item.mark}</span>{item.title}</NavLink>)}
      </nav>
      <div className="sidebar-footer"><span><i /> Сеанс DATA</span>
        <button type="button" onClick={logout}>Выйти <span aria-hidden="true">↗</span></button></div>
    </aside>
    <main className="workspace-main" id="workspace-content" tabIndex={-1}>
      <div className="content">
        <Routes>
          <Route path="/" element={<Navigate to={home} replace />} />
          <Route path="/overview" element={<Overview />} />
          <Route path="/audit" element={access.audit ? <AuditPage key="core" security={false} /> : <Navigate to={home} replace />} />
          <Route path="/audit/security" element={access.security ? <AuditPage key="auth" security /> : <Navigate to={home} replace />} />
          {access.recovery && <>
            <Route path="/reserve" element={<ReserveList key="reserve" reconcile={false} />} />
            <Route path="/reserve/new" element={<ReserveForm />} />
            <Route path="/reserve/:id" element={<ReserveDetailPage />} />
            <Route path="/reserve/:id/correct" element={<ReserveDetailPage correction />} />
            <Route path="/reconcile" element={<ReserveList key="reconcile" reconcile />} />
            <Route path="/reconcile/:id" element={<ReserveDetailPage reconcile />} />
          </>}
          {access.audit && <Route path="/statistics" element={<StatsPage />} />}
          {access.security && <Route path="/diagnostics" element={<DiagnosticsPage />} />}
          <Route path="*" element={<Empty title="Раздел недоступен"><NavLink to={home}>К рабочей области →</NavLink></Empty>} />
        </Routes>
      </div>
    </main>
  </div>;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode><QueryClientProvider client={client}><BrowserRouter>
    <SessionGate><Workspace /></SessionGate>
  </BrowserRouter></QueryClientProvider></StrictMode>,
);
