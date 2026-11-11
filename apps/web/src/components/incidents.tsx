import { useContext, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCheck, CircleAlert, CircleCheck, TriangleAlert } from 'lucide-react';
import type { Incident } from '@plantops/contracts';
import { api, RefreshContext } from '@/lib/api';
import { Button } from './ui/button';
import { Empty, Status } from './common';
import { dateTime } from '@/lib/utils';
export function Acknowledge({ incident }: { incident: Incident }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const { refresh } = useContext(RefreshContext);
  if (incident.status !== 'ACTIVE') return null;
  async function acknowledge() {
    setBusy(true);
    setError('');
    try {
      await api(`/incidents/${incident.id}/acknowledge`, { method: 'PATCH' });
      refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <Button size="sm" variant="outline" disabled={busy} onClick={acknowledge}>
        <CheckCheck />
        {busy ? 'Подтверждение…' : 'Подтвердить'}
      </Button>
      {error && (
        <small className="text-red" role="alert">
          {error}
        </small>
      )}
    </div>
  );
}
export function IncidentFeed({ items }: { items: Incident[] }) {
  if (!items.length)
    return (
      <div className="quiet-state">
        <CircleCheck size={32} />
        <strong>Участок работает штатно</strong>
        <p>Новых событий нет. Симулятор контролирует параметры каждые 2 секунды.</p>
        <Link to="/equipment/H-101">Открыть симуляцию Н-101 →</Link>
      </div>
    );
  return (
    <div className="incident-feed">
      {items.map((i) => (
        <div className="feed-item" key={i.id}>
          <span className={`event-icon ${i.severity === 'CRITICAL' ? 'text-red' : 'text-yellow'}`}>
            {i.severity === 'CRITICAL' ? <TriangleAlert size={17} /> : <CircleAlert size={17} />}
          </span>
          <div>
            <div className="feed-title">
              <Link to={`/equipment/${i.equipmentId}`}>{i.equipment.name}</Link>
              <time>{dateTime(i.occurredAt)}</time>
            </div>
            <p>{i.description}</p>
            <Status status={i.status} />
            <Acknowledge incident={i} />
          </div>
        </div>
      ))}
    </div>
  );
}
export function IncidentTable({ items }: { items: Incident[] }) {
  if (!items.length) return <Empty text="Инцидентов по выбранным условиям нет" />;
  return (
    <div className="table-scroll">
      <table className="incident-table">
        <thead>
          <tr>
            <th>Событие / оборудование</th>
            <th>Критичность</th>
            <th>Статус</th>
            <th>Временные отметки</th>
            <th>Действие</th>
          </tr>
        </thead>
        <tbody>
          {items.map((i) => (
            <tr key={i.id}>
              <td>
                <Link className="incident-equipment" to={`/equipment/${i.equipmentId}`}>
                  {i.equipment.name}{' '}
                  <span>
                    {i.type === 'TEMPERATURE'
                      ? 'Перегрев'
                      : i.type === 'PRESSURE'
                        ? 'Превышение давления'
                        : 'Повышенная вибрация'}
                  </span>
                </Link>
                <p>{i.description}</p>
                <code title={i.id}>{i.id}</code>
              </td>
              <td>
                <span
                  className={
                    i.severity === 'CRITICAL' ? 'severity text-red' : 'severity text-yellow'
                  }
                >
                  <TriangleAlert size={14} />
                  {i.severity === 'CRITICAL' ? 'Критическая' : 'Предупреждение'}
                </span>
              </td>
              <td>
                <Status status={i.status} />
              </td>
              <td className="timestamps">
                <span>
                  Возник: <b>{dateTime(i.occurredAt)}</b>
                </span>
                <span>
                  Подтв.: <b>{dateTime(i.acknowledgedAt)}</b>
                </span>
                <span>
                  Устранён: <b>{dateTime(i.resolvedAt)}</b>
                </span>
              </td>
              <td>
                <Acknowledge incident={i} />
                {i.status !== 'ACTIVE' && <span className="muted">—</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
