import { useContext, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, FlaskConical, Gauge, RotateCcw, Thermometer, Activity } from 'lucide-react';
import type { Equipment, FaultType, Incident, Page } from '@plantops/contracts';
import { api, RefreshContext, usePoll } from '@/lib/api';
import { Button } from '@/components/ui/button';
import {
  ErrorBanner,
  Loading,
  MetricTabs,
  PageHeading,
  Panel,
  PeriodSelect,
  Status,
  Value,
  type Metric,
} from '@/components/common';
import { TelemetryChart } from '@/components/telemetry-chart';
import { IncidentTable } from '@/components/incidents';
import { number, dateTime } from '@/lib/utils';
export function EquipmentDetail() {
  const { id = '' } = useParams();
  const e = usePoll<Equipment>(`/equipment/${encodeURIComponent(id)}`),
    [page, setPage] = useState(1);
  const incidents = usePoll<Page<Incident>>(
    `/incidents?equipmentId=${encodeURIComponent(id)}&pageSize=10&page=${page}`,
  );
  const [metric, setMetric] = useState<Metric>('temperature'),
    [minutes, setMinutes] = useState(15),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [actionError, setActionError] = useState('');
  const { refresh } = useContext(RefreshContext);
  async function action(type: FaultType | 'RESET') {
    if (
      type === 'RESET' &&
      !window.confirm('Восстановить нормальный режим и устранить связанные инциденты?')
    )
      return;
    setBusy(true);
    setMessage('');
    setActionError('');
    try {
      await api(`/simulation/equipment/${id}/${type === 'RESET' ? 'reset' : 'fault'}`, {
        method: 'POST',
        ...(type === 'RESET' ? {} : { body: JSON.stringify({ type }) }),
      });
      setMessage(
        type === 'RESET'
          ? 'Нормальный режим восстановлен. Инциденты сохранены в истории.'
          : 'Сценарий запущен. Показатели растут с каждым циклом симулятора.',
      );
      refresh();
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const asset = e.data;
  return (
    <>
      <Link className="back-link" to="/equipment">
        <ArrowLeft size={15} /> Всё оборудование
      </Link>
      <ErrorBanner error={e.error ?? incidents.error} />
      {!asset ? (
        e.loading ? (
          <Loading />
        ) : (
          <p>Оборудование недоступно.</p>
        )
      ) : (
        <>
          <PageHeading
            title={`${asset.name} · ${asset.description}`}
            description={`${asset.location} · ID: ${asset.id}`}
            actions={<Status status={asset.status} />}
          />
          <div className="detail-kpis">
            {(
              [
                { key: 'temperature', title: 'Температура', unit: '°C', icon: Thermometer },
                { key: 'pressure', title: 'Давление', unit: 'бар', icon: Gauge },
                { key: 'vibration', title: 'Вибрация', unit: 'мм/с', icon: Activity },
              ] as const
            ).map(({ key, title, unit, icon: Icon }) => (
              <div className="reading-card" key={key}>
                <span>
                  <Icon size={18} />
                  {title}
                </span>
                <Value value={asset[key]} unit={unit} />
                <small>
                  {asset[key] === null
                    ? 'Датчик не предусмотрен'
                    : `Обновлено ${dateTime(asset.updatedAt)}`}
                </small>
              </div>
            ))}
          </div>
          <div className="detail-grid">
            <Panel
              title="История параметров"
              actions={<PeriodSelect value={minutes} onChange={setMinutes} />}
            >
              <div className="chart-toolbar">
                <MetricTabs value={metric} onChange={setMetric} />
              </div>
              <TelemetryChart
                equipment={[asset]}
                metric={metric}
                minutes={minutes}
                threshold={
                  metric === 'temperature'
                    ? asset.temperatureWarning
                    : metric === 'pressure'
                      ? asset.pressureWarning
                      : (asset.vibrationWarning ?? undefined)
                }
              />
            </Panel>
            <Panel
              title="Симуляция неисправности"
              actions={<FlaskConical size={18} className="text-teal" />}
            >
              <div className="simulation-controls">
                <p>Измените режим оборудования и наблюдайте за телеметрией и журналом событий.</p>
                <Button
                  variant="destructive"
                  disabled={busy || asset.overheat}
                  onClick={() => action('OVERHEAT')}
                >
                  <Thermometer />
                  {asset.overheat ? 'Перегрев активен' : 'Симулировать перегрев'}
                </Button>
                <Button
                  variant="outline"
                  disabled={busy || asset.overpressure}
                  onClick={() => action('OVERPRESSURE')}
                >
                  <Gauge />
                  {asset.overpressure
                    ? 'Превышение давления активно'
                    : 'Симулировать превышение давления'}
                </Button>
                <Button
                  variant="outline"
                  disabled={busy || asset.highVibration || asset.vibration === null}
                  onClick={() => action('HIGH_VIBRATION')}
                >
                  <Activity />
                  {asset.highVibration ? 'Вибрация активна' : 'Симулировать вибрацию'}
                </Button>
                <Button
                  variant="outline"
                  disabled={
                    busy ||
                    (asset.overheat &&
                      asset.overpressure &&
                      (asset.highVibration || asset.vibration === null))
                  }
                  onClick={() => action('COMBINED')}
                >
                  Комбинированная неисправность
                </Button>
                <div className="control-divider" />
                <Button
                  variant="secondary"
                  disabled={
                    busy ||
                    (!asset.overheat &&
                      !asset.overpressure &&
                      !asset.highVibration &&
                      asset.status === 'NORMAL')
                  }
                  onClick={() => action('RESET')}
                >
                  <RotateCcw />
                  Восстановить нормальный режим
                </Button>
                {message && (
                  <p className="action-message" role="status">
                    {message}
                  </p>
                )}
                {actionError && (
                  <p className="text-red" role="alert">
                    {actionError}
                  </p>
                )}
                <small>Учебные сценарии. Связи с реальным оборудованием нет.</small>
              </div>
            </Panel>
          </div>
          <Panel
            title="Учебные пороговые значения"
            actions={<span className="muted">Порог срабатывает при ≥</span>}
          >
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Параметр</th>
                    <th>Номинальное значение</th>
                    <th>Предупреждение</th>
                    <th>Критический уровень</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    {
                      label: 'Температура, °C',
                      base: asset.temperatureBase,
                      warning: asset.temperatureWarning,
                      critical: asset.temperatureCritical,
                    },
                    {
                      label: 'Давление, бар',
                      base: asset.pressureBase,
                      warning: asset.pressureWarning,
                      critical: asset.pressureCritical,
                    },
                    {
                      label: 'Вибрация, мм/с',
                      base: asset.vibrationBase,
                      warning: asset.vibrationWarning,
                      critical: asset.vibrationCritical,
                    },
                  ].map((row) => (
                    <tr key={row.label}>
                      <td>{row.label}</td>
                      <td className="mono">{number(row.base)}</td>
                      <td className="mono text-yellow">{number(row.warning)}</td>
                      <td className="mono text-red">{number(row.critical)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
          <Panel
            title="Связанные инциденты"
            actions={<span className="count-label">{incidents.data?.total ?? 0} за всё время</span>}
          >
            {incidents.data ? (
              <>
                <IncidentTable items={incidents.data.items} />
                <div className="pagination">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={page === 1}
                    onClick={() => setPage(page - 1)}
                  >
                    Назад
                  </Button>
                  <span>Страница {page}</span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={page * 10 >= incidents.data.total}
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
      )}
    </>
  );
}
