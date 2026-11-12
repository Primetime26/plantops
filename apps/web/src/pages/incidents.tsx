import { useState } from 'react';
import type { Equipment, Incident, Page } from '@plantops/contracts';
import { downloadCsv, usePoll } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { ErrorBanner, Loading, PageHeading, Panel } from '@/components/common';
import { IncidentTable } from '@/components/incidents';
export function IncidentsPage() {
  const [status, setStatus] = useState(''),
    [severity, setSeverity] = useState(''),
    [equipmentId, setEquipmentId] = useState(''),
    [page, setPage] = useState(1);
  const equipment = usePoll<Equipment[]>('/equipment');
  const params = new URLSearchParams({ page: String(page), pageSize: '15' });
  if (status) params.set('status', status);
  if (severity) params.set('severity', severity);
  if (equipmentId) params.set('equipmentId', equipmentId);
  const data = usePoll<Page<Incident>>(`/incidents?${params}`);
  const update = (setter: (v: string) => void, value: string) => {
    setter(value);
    setPage(1);
  };
  return (
    <>
      <PageHeading
        title="Аварии и инциденты"
        description="Журнал событий, подтверждения оператора и история устранения."
        actions={
          <Button
            variant="outline"
            onClick={() => downloadCsv(`/incidents/export?${params}`, 'plantops-incidents.csv')}
          >
            Экспорт CSV
          </Button>
        }
      />
      <div className="info-strip">
        Подтверждение означает, что оператор увидел сообщение. Инцидент устраняется только после
        возврата параметров в норму.
      </div>
      <ErrorBanner error={data.error ?? equipment.error} />
      <Panel
        title="Журнал событий"
        actions={<span className="count-label">Найдено: {data.data?.total ?? 0}</span>}
      >
        <div className="filter-bar">
          <select
            aria-label="Статус инцидента"
            value={status}
            onChange={(e) => update(setStatus, e.target.value)}
          >
            <option value="">Все статусы</option>
            <option value="ACTIVE">Активные</option>
            <option value="ACKNOWLEDGED">Подтверждённые</option>
            <option value="RESOLVED">Устранённые</option>
          </select>
          <select
            aria-label="Критичность"
            value={severity}
            onChange={(e) => update(setSeverity, e.target.value)}
          >
            <option value="">Все уровни критичности</option>
            <option value="WARNING">Предупреждение</option>
            <option value="CRITICAL">Критические</option>
          </select>
          <select
            aria-label="Оборудование"
            value={equipmentId}
            onChange={(e) => update(setEquipmentId, e.target.value)}
          >
            <option value="">Всё оборудование</option>
            {equipment.data?.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name} — {e.description}
              </option>
            ))}
          </select>
        </div>
        {data.data ? (
          <>
            <IncidentTable items={data.data.items} />
            <div className="pagination">
              <span>
                {data.data.total
                  ? `${(page - 1) * 15 + 1}–${Math.min(page * 15, data.data.total)} из ${data.data.total}`
                  : '0 событий'}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page === 1}
                onClick={() => setPage(page - 1)}
              >
                Назад
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page * 15 >= data.data.total}
                onClick={() => setPage(page + 1)}
              >
                Далее
              </Button>
            </div>
          </>
        ) : (
          <Loading />
        )}
      </Panel>
    </>
  );
}
