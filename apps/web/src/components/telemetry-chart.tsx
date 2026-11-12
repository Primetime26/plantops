import { useEffect, useState, useContext } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { Equipment, TelemetryReading } from '@plantops/contracts';
import { api, runtime, pollingAllowed, RefreshContext } from '@/lib/api';
import { colors, Empty, ErrorBanner, Loading, metricMeta, type Metric } from './common';
import { number } from '@/lib/utils';
type ChartPoint = { timestamp: number; [id: string]: number | null };
const shortTime = (n: number) =>
  new Date(n).toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
export function TelemetryChart({
  equipment,
  metric,
  minutes,
  threshold,
}: {
  equipment: Equipment[];
  metric: Metric;
  minutes: number;
  threshold?: number;
}) {
  const [state, setState] = useState<{
    key: string;
    points: ChartPoint[];
    error?: string;
    loaded: boolean;
  }>({ key: '', points: [], loaded: false });
  const ids = equipment.map((e) => e.id).join(','),
    key = `${ids}:${metric}:${minutes}`;
  const { version } = useContext(RefreshContext);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function load() {
      if (!pollingAllowed()) {
        if (active) timer = setTimeout(load, 1000);
        return;
      }
      try {
        const all = await api<{ id: string; items: TelemetryReading[]; bucketMs: number }[]>(
          `/telemetry?minutes=${minutes}`,
          { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(45000)]) },
        );
        const series = all.filter((s) => ids.split(',').includes(s.id));
        const grouped = new Map<number, ChartPoint>();
        for (const seriesItem of series)
          for (const point of seriesItem.items) {
            const bucket =
              Math.floor(new Date(point.timestamp).getTime() / seriesItem.bucketMs) *
              seriesItem.bucketMs;
            const row = grouped.get(bucket) ?? { timestamp: bucket };
            row[seriesItem.id] = point[metric];
            grouped.set(bucket, row);
          }
        if (active)
          setState({
            key,
            points: [...grouped.values()].sort((a, b) => a.timestamp - b.timestamp),
            loaded: true,
          });
      } catch (e) {
        if (active)
          setState((s) => ({
            ...s,
            error: e instanceof Error ? e.message : 'Ошибка графика',
            loaded: true,
          }));
      }
      if (active) timer = setTimeout(load, runtime()?.pollMs ?? 5000);
    }
    void load();
    return () => {
      active = false;
      controller.abort();
      clearTimeout(timer);
    };
  }, [ids, metric, minutes, version, key]);
  const points = state.key === key ? state.points : [];
  return (
    <>
      <ErrorBanner error={state.error} />
      <div
        className="chart"
        role="img"
        aria-label={`${metricMeta[metric].title}: история за ${minutes} минут`}
      >
        {metric === 'vibration' && equipment.every((e) => e.vibration === null) ? (
          <Empty text="Датчик вибрации не предусмотрен для этого оборудования" />
        ) : !state.loaded || (state.key !== key && !state.error) ? (
          <Loading />
        ) : points.length === 0 ? (
          <Empty text="История появится после первого цикла симулятора" />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={points} margin={{ top: 18, right: 22, left: -16, bottom: 4 }}>
              <CartesianGrid stroke="#273038" strokeDasharray="3 5" vertical={false} />
              <XAxis
                dataKey="timestamp"
                type="number"
                domain={['dataMin', 'dataMax']}
                tickFormatter={shortTime}
                tick={{ fill: '#7f8b96', fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                minTickGap={65}
              />
              <YAxis
                tick={{ fill: '#7f8b96', fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                domain={[0, 'auto']}
                width={58}
              />
              <Tooltip
                contentStyle={{
                  background: '#1c242c',
                  border: '1px solid #36424c',
                  borderRadius: 8,
                  fontSize: 12,
                }}
                labelFormatter={(v) => shortTime(Number(v))}
                formatter={(v) => [`${number(Number(v))} ${metricMeta[metric].unit}`]}
              />
              {threshold !== undefined && (
                <ReferenceLine
                  y={threshold}
                  stroke="#edb56a"
                  strokeDasharray="5 5"
                  label={{
                    value: 'Порог предупреждения',
                    fill: '#edb56a',
                    fontSize: 10,
                    position: 'insideTopRight',
                  }}
                />
              )}
              {equipment.map((e, i) => (
                <Line
                  key={e.id}
                  type="monotone"
                  dataKey={e.id}
                  name={e.name}
                  stroke={colors[i % colors.length]}
                  strokeWidth={2}
                  dot={points.length < 3 ? { r: 3 } : false}
                  activeDot={{ r: 4, strokeWidth: 0 }}
                  isAnimationActive={false}
                  connectNulls={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
      <div className="chart-legend">
        {equipment
          .filter((e) => metric !== 'vibration' || e.vibration !== null)
          .map((e, i) => (
            <span key={e.id}>
              <i style={{ background: colors[i % colors.length] }} />
              {e.name}
            </span>
          ))}
        <small>{metricMeta[metric].unit} · среднее по интервалу</small>
      </div>
    </>
  );
}
