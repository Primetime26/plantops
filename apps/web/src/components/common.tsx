import type { ReactNode } from 'react';
import {
  Activity,
  AlertCircle,
  Box,
  Check,
  CircleAlert,
  Fan,
  Flame,
  Gauge,
  Thermometer,
  Waves,
} from 'lucide-react';
import type { Equipment, EquipmentStatus, IncidentStatus, Summary } from '@plantops/contracts';
import { Button } from './ui/button';
import { cn, number } from '@/lib/utils';
export const statusText = {
  NORMAL: 'В норме',
  WARNING: 'Предупреждение',
  CRITICAL: 'Критическое',
  ACTIVE: 'Активен',
  ACKNOWLEDGED: 'Подтверждён',
  RESOLVED: 'Устранён',
};
export const colors = ['#56cdb2', '#6a9cf5', '#b298ed', '#edb56a', '#7cc9df'];
export function Status({ status }: { status: EquipmentStatus | IncidentStatus }) {
  return (
    <span className={cn('status', status.toLowerCase())}>
      <i />
      {statusText[status]}
    </span>
  );
}
export function Panel({
  title,
  eyebrow,
  actions,
  children,
  className = '',
}: {
  title: string;
  eyebrow?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      <div className="panel-head">
        <div>
          {eyebrow && <span className="eyebrow">{eyebrow}</span>}
          <h2>{title}</h2>
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}
export function PageHeading({
  title,
  description,
  actions,
}: {
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {actions}
    </div>
  );
}
export function ErrorBanner({ error }: { error?: string }) {
  return error ? (
    <div className="error-banner" role="alert">
      <AlertCircle size={17} />
      <span>{error}. Данные могут быть устаревшими. Повторное подключение автоматически.</span>
    </div>
  ) : null;
}
export function Loading() {
  return (
    <div className="empty">
      <div className="skeleton-lines" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
      <span>Получаем данные участка…</span>
    </div>
  );
}
export function Empty({ text = 'За выбранный период нет данных' }: { text?: string }) {
  return (
    <div className="empty">
      <Activity size={26} />
      <span>{text}</span>
    </div>
  );
}
export function EquipmentIcon({ type, size = 22 }: { type: Equipment['type']; size?: number }) {
  const Icon = type === 'COMPRESSOR' ? Fan : type === 'HEAT_EXCHANGER' ? Waves : Gauge;
  return <Icon size={size} />;
}
export function Kpis({ data }: { data: Summary }) {
  const metrics = [
    {
      label: 'Всего оборудования',
      value: data.total,
      icon: Box,
      color: 'neutral',
      hint: 'На производственном участке',
    },
    {
      label: 'В норме',
      value: data.normal,
      icon: Check,
      color: 'green',
      hint: 'Работа в допустимых пределах',
    },
    {
      label: 'Предупреждения',
      value: data.warning,
      icon: CircleAlert,
      color: 'yellow',
      hint: 'Требуют внимания',
    },
    {
      label: 'Критические',
      value: data.critical,
      icon: Flame,
      color: 'red',
      hint: 'Превышен критический порог',
    },
    {
      label: 'Активные инциденты',
      value: data.activeIncidents,
      icon: Activity,
      color: 'blue',
      hint: `Не подтверждено: ${data.unacknowledged}`,
    },
  ];
  return (
    <div className="kpis">
      {metrics.map(({ label, value, icon: Icon, color, hint }) => (
        <div className={`kpi ${color}`} key={label}>
          <div className="kpi-label">
            {label}
            <Icon size={17} />
          </div>
          <strong>{String(value).padStart(2, '0')}</strong>
          <span className="kpi-hint">
            <i />
            {hint}
          </span>
        </div>
      ))}
    </div>
  );
}
export function PeriodSelect({
  value,
  onChange,
}: {
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <select
      aria-label="Период данных"
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
    >
      {[
        [5, '5 минут'],
        [15, '15 минут'],
        [60, '1 час'],
        [360, '6 часов'],
        [1440, '24 часа'],
      ].map(([v, label]) => (
        <option value={v} key={v}>
          {label}
        </option>
      ))}
    </select>
  );
}
export type Metric = 'temperature' | 'pressure' | 'vibration';
export const metricMeta = {
  temperature: { title: 'Температура', unit: '°C', icon: Thermometer },
  pressure: { title: 'Давление', unit: 'бар', icon: Gauge },
  vibration: { title: 'Вибрация', unit: 'мм/с', icon: Activity },
};
export function MetricTabs({ value, onChange }: { value: Metric; onChange: (m: Metric) => void }) {
  return (
    <div className="segmented" aria-label="Параметр">
      {(Object.keys(metricMeta) as Metric[]).map((m) => (
        <Button
          key={m}
          size="sm"
          variant="ghost"
          aria-pressed={value === m}
          className={value === m ? 'selected' : ''}
          onClick={() => onChange(m)}
        >
          {metricMeta[m].title}
        </Button>
      ))}
    </div>
  );
}
export function Value({ value, unit }: { value: number | null; unit: string }) {
  return (
    <span className="value">
      {number(value)} <small>{unit}</small>
    </span>
  );
}
