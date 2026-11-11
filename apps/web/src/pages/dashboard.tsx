import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Radio, Workflow } from 'lucide-react';
import type { Equipment, Incident, Page, Summary } from '@plantops/contracts';
import { usePoll } from '@/lib/api';
import { Button } from '@/components/ui/button';
import {
  EquipmentIcon,
  ErrorBanner,
  Kpis,
  Loading,
  MetricTabs,
  PageHeading,
  Panel,
  PeriodSelect,
  type Metric,
} from '@/components/common';
import { TelemetryChart } from '@/components/telemetry-chart';
import { EquipmentTable } from '@/components/equipment-table';
import { IncidentFeed } from '@/components/incidents';
export function Dashboard({ summary }: { summary?: Summary }) {
  const equipment = usePoll<Equipment[]>('/equipment'),
    incidents = usePoll<Page<Incident>>('/incidents?pageSize=4');
  const [metric, setMetric] = useState<Metric>('temperature'),
    [minutes, setMinutes] = useState(15);
  return (
    <>
      <PageHeading
        title="Обзор участка"
        description="Всё оборудование. Все параметры. Под контролем."
        actions={
          <span className="live-label">
            <Radio size={15} /> Обновление каждые 2 с
          </span>
        }
      />
      <ErrorBanner error={equipment.error ?? incidents.error} />
      {summary && <Kpis data={summary} />}
      <div className="overview-grid">
        <Panel
          title="Динамика показателей"
          eyebrow="ТЕЛЕМЕТРИЯ"
          actions={<PeriodSelect value={minutes} onChange={setMinutes} />}
        >
          <div className="chart-toolbar">
            <MetricTabs value={metric} onChange={setMetric} />
            <span className="subtle-label">5 источников</span>
          </div>
          {equipment.data ? (
            <TelemetryChart equipment={equipment.data} metric={metric} minutes={minutes} />
          ) : (
            <Loading />
          )}
        </Panel>
        <Panel
          title="Производственный участок"
          eyebrow="СОСТОЯНИЕ СИСТЕМЫ"
          actions={<Workflow size={18} className="muted" />}
        >
          <div className="process-map">
            <div className="process-caption">
              <span>УЧАСТОК 01</span>
              <span>ЗАМКНУТЫЙ КОНТУР</span>
            </div>
            <div className="process-units">
              {equipment.data?.map((e) => (
                <Link
                  key={e.id}
                  to={`/equipment/${e.id}`}
                  className={`process-unit ${e.status.toLowerCase()}`}
                >
                  <span className="process-icon">
                    <EquipmentIcon type={e.type} size={25} />
                    <i />
                  </span>
                  <strong>{e.name}</strong>
                </Link>
              ))}
            </div>
            <div className="process-flow">
              <i />
              <span>Подача</span>
              <i />
              <span>Обработка</span>
              <i />
              <span>Циркуляция</span>
              <i />
            </div>
          </div>
          <div className="plant-state">
            <span
              className={`state-beacon ${(summary?.critical ?? 0) > 0 ? 'danger' : (summary?.warning ?? 0) > 0 ? 'warn' : ''}`}
            />
            <div>
              <strong>
                {!summary
                  ? 'Подключение к участку'
                  : summary.critical
                    ? 'Обнаружены неисправности'
                    : summary.warning
                      ? 'Требуется внимание'
                      : 'Оборудование в норме'}
              </strong>
              <p>
                {summary?.activeIncidents
                  ? `Незавершённых инцидентов: ${summary.activeIncidents}`
                  : 'Все параметры в допустимых пределах'}
              </p>
            </div>
          </div>
          <div className="plant-facts">
            <span>
              Источники данных<b>Программный симулятор</b>
            </span>
            <span>
              Режим работы<b>Демонстрационный</b>
            </span>
          </div>
        </Panel>
      </div>
      <div className="overview-grid bottom-grid">
        <Panel
          title="Оборудование"
          actions={
            <Button variant="ghost" size="sm" asChild>
              <Link to="/equipment">
                Все единицы <ArrowRight />
              </Link>
            </Button>
          }
        >
          {equipment.data ? <EquipmentTable items={equipment.data} /> : <Loading />}
        </Panel>
        <Panel
          title="Последние события"
          actions={
            <Link
              className="muted icon-link"
              aria-label="Открыть журнал инцидентов"
              to="/incidents"
            >
              <ArrowRight size={18} />
            </Link>
          }
        >
          {incidents.data ? <IncidentFeed items={incidents.data.items} /> : <Loading />}
        </Panel>
      </div>
    </>
  );
}
