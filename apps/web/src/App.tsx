import { lazy, Suspense, useEffect, useState } from 'react';
import { Link, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import {
  Activity,
  ArrowUpRight,
  Bell,
  ChartNoAxesCombined,
  ChevronRight,
  CircleHelp,
  Factory,
  FlaskConical,
  LayoutDashboard,
  Server,
  Settings2,
  ShieldCheck,
} from 'lucide-react';
import type { Summary } from '@plantops/contracts';
import { runtime, pollingAllowed, RefreshContext, usePoll } from '@/lib/api';
import { ErrorBanner, Loading } from '@/components/common';
import { SessionGate, DemoBanner } from '@/components/session-gate';
const MaintenancePage = lazy(() =>
  import('@/pages/maintenance').then((m) => ({ default: m.MaintenancePage })),
);
const Dashboard = lazy(() => import('@/pages/dashboard').then((m) => ({ default: m.Dashboard })));
const EquipmentPage = lazy(() =>
  import('@/pages/equipment').then((m) => ({ default: m.EquipmentPage })),
);
const EquipmentDetail = lazy(() =>
  import('@/pages/equipment-detail').then((m) => ({ default: m.EquipmentDetail })),
);
const IncidentsPage = lazy(() =>
  import('@/pages/incidents').then((m) => ({ default: m.IncidentsPage })),
);
const AnalyticsPage = lazy(() =>
  import('@/pages/analytics').then((m) => ({ default: m.AnalyticsPage })),
);
function Shell() {
  const summary = usePoll<Summary>('/dashboard/summary'),
    [clock, setClock] = useState(new Date());
  const location = useLocation();
  useEffect(() => {
    const timer = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);
  const nav = [
    { to: '/', label: 'Главная панель', icon: LayoutDashboard },
    { to: '/equipment', label: 'Оборудование', icon: Settings2 },
    { to: '/incidents', label: 'Аварии и инциденты', icon: Bell },
    { to: '/maintenance', label: 'Техобслуживание', icon: Settings2 },
    { to: '/analytics', label: 'Аналитика', icon: ChartNoAxesCombined },
  ];
  const title =
    nav.find((n) => (n.to === '/' ? location.pathname === '/' : location.pathname.startsWith(n.to)))
      ?.label ?? 'Страница';
  const paused = runtime()?.mode === 'demo' && !pollingAllowed();
  const sim = summary.data?.simulator,
    live =
      !summary.error &&
      sim?.running &&
      !sim.error &&
      !!sim.lastTickAt &&
      (sim.mode === 'on-demand' || clock.getTime() - new Date(sim.lastTickAt).getTime() < 8000);
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link to="/" className="brand" aria-label="PlantOps — главная панель">
          <span>
            <Factory size={23} />
          </span>
          <div>
            PlantOps<small>INDUSTRIAL MONITORING</small>
          </div>
        </Link>
        <div className="workspace-label">РАБОЧЕЕ ПРОСТРАНСТВО</div>
        <nav>
          {nav.map(({ to, label, icon: Icon }) => (
            <NavLink
              to={to}
              end={to === '/'}
              key={to}
              aria-label={label}
              title={label}
              className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
            >
              <Icon size={18} />
              <span>{label}</span>
              {to === '/incidents' && !!summary.data?.activeIncidents && (
                <b>{summary.data.activeIncidents}</b>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="demo-card">
            <FlaskConical size={18} />
            <strong>Демонстрационный стенд</strong>
            <p>
              Виртуальное оборудование.
              <br />
              Реальные возможности.
            </p>
            <Link to="/equipment/H-101">
              Запустить сценарий <ArrowUpRight size={14} />
            </Link>
          </div>
          <div className="system-status">
            <i className={live ? 'online' : 'offline'} />
            <span>
              {paused
                ? 'Мониторинг на паузе'
                : live
                  ? 'Симулятор работает'
                  : 'Симулятор недоступен'}
            </span>
            <small>v2.0</small>
          </div>
          <div className="operator">
            <span>ОП</span>
            <div>
              Оператор участка
              <small>
                {runtime()?.mode === 'demo' ? 'Гостевая демосессия' : 'Локальная сессия'}
              </small>
            </div>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumbs">
            <Factory size={15} />
            <span>Участок 01</span>
            <ChevronRight size={14} />
            <b>{title}</b>
          </div>
          <div className="topbar-right">
            <span
              className={`sim-badge ${live ? '' : 'offline'}`}
              role="status"
              aria-label={
                paused
                  ? 'Мониторинг на паузе'
                  : live
                    ? 'Симулятор активен'
                    : 'Нет сигнала симулятора'
              }
              title={
                paused
                  ? 'Мониторинг на паузе'
                  : live
                    ? 'Симулятор активен'
                    : 'Нет сигнала симулятора'
              }
            >
              <i />
              {paused ? 'Мониторинг на паузе' : live ? 'Симулятор активен' : 'Нет сигнала'}
            </span>
            <span className="demo-badge">
              <FlaskConical size={13} />
              Демонстрационные данные
            </span>
            <Link to="/incidents" className="notification" aria-label="Открыть уведомления">
              <Bell size={18} />
              {!!summary.data?.unacknowledged && <i />}
            </Link>
            <span className="header-avatar">ОП</span>
          </div>
        </header>
        <main>
          <DemoBanner />
          <div className="context-row">
            <span>
              <span className="context-dot" />
              PLANTOPS / ПРОИЗВОДСТВЕННЫЙ МОНИТОРИНГ
            </span>
            <time>
              {clock.toLocaleDateString('ru-RU', {
                day: '2-digit',
                month: 'long',
                year: 'numeric',
              })}
              <i /> {clock.toLocaleTimeString('ru-RU')}
            </time>
          </div>
          <ErrorBanner error={summary.error ?? (sim?.error || undefined)} />
          <Suspense fallback={<Loading />}>
            <Routes>
              <Route path="/" element={<Dashboard summary={summary.data} />} />
              <Route path="/equipment" element={<EquipmentPage />} />
              <Route path="/equipment/:id" element={<EquipmentDetail />} />
              <Route path="/incidents" element={<IncidentsPage />} />
              <Route path="/maintenance" element={<MaintenancePage />} />
              <Route path="/analytics" element={<AnalyticsPage summary={summary.data} />} />
              <Route
                path="*"
                element={
                  <div className="empty">
                    <CircleHelp />
                    <h1>Страница не найдена</h1>
                    <Link to="/">Вернуться на главную панель</Link>
                  </div>
                }
              />
            </Routes>
          </Suspense>
          <footer>
            <span>
              <ShieldCheck size={14} />
              Учебные показатели и пороги. Не для управления реальным оборудованием.
            </span>
            <span>
              <Server size={13} /> {runtime()?.mode === 'demo' ? 'Временное хранилище' : 'SQLite'}{' '}
              <i /> <Activity size={13} /> Интервал {runtime()?.pollMs === 5000 ? '5' : '2'} с
            </span>
          </footer>
        </main>
      </div>
    </div>
  );
}
export default function App() {
  const [version, setVersion] = useState(0);
  return (
    <RefreshContext.Provider value={{ version, refresh: () => setVersion((v) => v + 1) }}>
      <SessionGate>
        <Shell />
      </SessionGate>
    </RefreshContext.Provider>
  );
}
