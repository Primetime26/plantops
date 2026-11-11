import { Link } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import type { Equipment } from '@plantops/contracts';
import { EquipmentIcon, Status, Value, Empty } from './common';
import { time } from '@/lib/utils';
export function EquipmentTable({ items }: { items: Equipment[] }) {
  if (!items.length) return <Empty text="Оборудование не найдено. Измените условия поиска." />;
  return (
    <div className="table-scroll">
      <table className="equipment-table">
        <thead>
          <tr>
            <th>Оборудование</th>
            <th>Состояние</th>
            <th>Темп., °C</th>
            <th>Давл., бар</th>
            <th>Вибр., мм/с</th>
            <th>Обновлено</th>
            <th>
              <span className="sr-only">Карточка</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((e) => (
            <tr key={e.id}>
              <td>
                <Link className="equipment-name" to={`/equipment/${e.id}`}>
                  <span className="asset-icon">
                    <EquipmentIcon type={e.type} />
                  </span>
                  <span>
                    <strong>{e.name}</strong>
                    <small>{e.description}</small>
                  </span>
                </Link>
              </td>
              <td>
                <Status status={e.status} />
              </td>
              <td
                className={
                  e.temperature >= e.temperatureCritical
                    ? 'text-red'
                    : e.temperature >= e.temperatureWarning
                      ? 'text-yellow'
                      : ''
                }
              >
                <Value value={e.temperature} unit="" />
              </td>
              <td
                className={
                  e.pressure >= e.pressureCritical
                    ? 'text-red'
                    : e.pressure >= e.pressureWarning
                      ? 'text-yellow'
                      : ''
                }
              >
                <Value value={e.pressure} unit="" />
              </td>
              <td>
                <Value value={e.vibration} unit="" />
              </td>
              <td className="muted mono">{time(e.updatedAt)}</td>
              <td>
                <Link
                  className="icon-link"
                  aria-label={`Открыть ${e.name}`}
                  to={`/equipment/${e.id}`}
                >
                  <ArrowUpRight size={17} />
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
