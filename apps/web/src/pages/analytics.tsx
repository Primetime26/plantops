import { useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { Analytics, Equipment, Summary } from '@plantops/contracts';
import { downloadCsv, usePoll } from '@/lib/api';
import { Empty, ErrorBanner, Loading, PageHeading, Panel, PeriodSelect } from '@/components/common';
import { TelemetryChart } from '@/components/telemetry-chart';
import { Button } from '@/components/ui/button';
const tooltipStyle = {
  background: '#1c242c',
  border: '1px solid #36424c',
  borderRadius: 8,
  fontSize: 12,
};
export function AnalyticsPage({ summary }: { summary?: Summary }) {
  const [minutes, setMinutes] = useState(60),
    [equipmentId, setEquipmentId] = useState('');
  const equipment = usePoll<Equipment[]>('/equipment'),
    analytics = usePoll<Analytics>(`/analytics?minutes=${minutes}`, 5000);
  const selected = equipment.data?.filter((e) => !equipmentId || e.id === equipmentId);
  const bars = equipment.data?.map((e) => ({
    name: e.name,
    count: analytics.data?.incidentsByEquipment.find((i) => i.id === e.id)?.count ?? 0,
  }));
  const slices = analytics.data?.incidentsBySeverity.map((i) => ({
    name: i.severity === 'CRITICAL' ? 'Критические' : 'Предупреждения',
    value: i.count,
    color: i.severity === 'CRITICAL' ? '#f0787e' : '#edb56a',
  }));
  return (
    <>
      <PageHeading
        title="Аналитика"
        description="Накопленная телеметрия и события производственного участка."
        actions={
          <div className="inline-controls">
            <Button
              variant="outline"
              onClick={() =>
                downloadCsv(`/analytics/export?minutes=${minutes}`, 'plantops-telemetry.csv')
              }
            >
              Экспорт CSV
            </Button>
            <select
              aria-label="Оборудование для анализа"
              value={equipmentId}
              onChange={(e) => setEquipmentId(e.target.value)}
            >
              <option value="">Все единицы</option>
              {equipment.data?.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
            <PeriodSelect value={minutes} onChange={setMinutes} />
          </div>
        }
      />
      <ErrorBanner error={equipment.error ?? analytics.error} />
      <div className="analytics-kpis">
        {[
          { label: 'Записей за период', value: analytics.data?.totalReadings },
          { label: 'Инцидентов за период', value: analytics.data?.totalIncidents },
          { label: 'Из них устранено', value: analytics.data?.resolvedIncidents },
          {
            label: 'В норме сейчас',
            value: summary ? `${summary.normal} / ${summary.total}` : undefined,
          },
        ].map((k) => (
          <div className="reading-card" key={k.label}>
            <span>{k.label}</span>
            <strong>{k.value ?? '—'}</strong>
            <small>По всему участку</small>
          </div>
        ))}
      </div>
      <div className="maintenance-strip" aria-label="Распределение неисправностей">
        <strong>Причины событий</strong>
        {analytics.data?.incidentsByType.map((i) => (
          <span key={i.type}>
            {{ TEMPERATURE: 'Температура', PRESSURE: 'Давление', VIBRATION: 'Вибрация' }[i.type]}:{' '}
            <b>{i.count}</b>
          </span>
        ))}
      </div>
      <div className="analytics-grid">
        <Panel title="Температура" eyebrow="°C">
          {selected ? (
            <TelemetryChart equipment={selected} metric="temperature" minutes={minutes} />
          ) : (
            <Loading />
          )}
        </Panel>
        <Panel title="Давление" eyebrow="БАР">
          {selected ? (
            <TelemetryChart equipment={selected} metric="pressure" minutes={minutes} />
          ) : (
            <Loading />
          )}
        </Panel>
        <Panel title="Инциденты по оборудованию" eyebrow="ЗА ВЫБРАННЫЙ ПЕРИОД">
          {analytics.data?.totalIncidents ? (
            <div className="chart">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={bars} margin={{ top: 24, right: 24, bottom: 8, left: -15 }}>
                  <CartesianGrid stroke="#273038" vertical={false} strokeDasharray="3 5" />
                  <XAxis
                    dataKey="name"
                    tick={{ fill: '#8896a3', fontSize: 12 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fill: '#8896a3', fontSize: 12 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Bar
                    dataKey="count"
                    name="Инциденты"
                    fill="#6a9cf5"
                    radius={[4, 4, 0, 0]}
                    maxBarSize={42}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <Empty text="За период инцидентов не зарегистрировано" />
          )}
        </Panel>
        <Panel title="Распределение по критичности" eyebrow="МАКСИМАЛЬНЫЙ УРОВЕНЬ ИНЦИДЕНТА">
          {analytics.data?.totalIncidents ? (
            <>
              <div className="chart donut">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={slices}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={65}
                      outerRadius={92}
                      paddingAngle={4}
                      stroke="none"
                    >
                      {slices?.map((s) => (
                        <Cell key={s.name} fill={s.color} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={tooltipStyle} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="donut-total">
                  <strong>{analytics.data.totalIncidents}</strong>
                  <span>инцидентов</span>
                </div>
              </div>
              <div className="chart-legend">
                {slices?.map((s) => (
                  <span key={s.name}>
                    <i style={{ background: s.color }} />
                    {s.name}: {s.value}
                  </span>
                ))}
              </div>
            </>
          ) : (
            <Empty text="Распределение появится после первого события" />
          )}
        </Panel>
      </div>
    </>
  );
}
