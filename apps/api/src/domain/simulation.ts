import type { EquipmentRecord as Equipment } from './models.js';
import type { EquipmentStatus, EventType, Severity } from '@plantops/contracts';
export interface Values {
  temperature: number;
  pressure: number;
  vibration: number | null;
}
export interface Alarm {
  type: EventType;
  severity: Severity;
  value: number;
  threshold: number;
}
const round = (n: number) => Math.round(n * 100) / 100;
const move = (current: number, target: number, step: number) =>
  current + Math.max(-step, Math.min(step, target - current));
export function nextValues(e: Equipment, time: Date, random = () => 0.5): Values {
  const phase = time.getTime() / 18000 + [...e.id].reduce((n, c) => n + c.charCodeAt(0), 0);
  const normalTemp = e.temperatureBase + Math.sin(phase) * 1.8 + (random() - 0.5) * 0.3;
  const normalPressure = e.pressureBase + Math.sin(phase * 0.7) * 0.15;
  return {
    temperature: round(
      move(
        e.temperature,
        e.overheat ? e.temperatureCritical + 8 : normalTemp,
        e.overheat ? 8 : 1.5,
      ),
    ),
    pressure: round(
      move(
        e.pressure,
        e.overpressure ? e.pressureCritical + 1.2 : normalPressure,
        e.overpressure ? 0.8 : 0.15,
      ),
    ),
    vibration:
      e.vibrationBase === null
        ? null
        : round(
            move(
              e.vibration ?? e.vibrationBase,
              e.highVibration
                ? (e.vibrationCritical ?? 7) + 1
                : e.vibrationBase + Math.sin(phase * 1.4) * 0.22,
              e.highVibration ? 1.4 : 0.15,
            ),
          ),
  };
}
export function evaluate(
  e: Equipment,
  values: Values,
): { status: EquipmentStatus; alarms: Alarm[] } {
  const alarms: Alarm[] = [];
  const check = (
    type: EventType,
    value: number | null,
    warning: number | null,
    critical: number | null,
  ) => {
    if (value === null || warning === null || critical === null || value < warning) return;
    const severity = value >= critical ? 'CRITICAL' : 'WARNING';
    alarms.push({ type, value, severity, threshold: severity === 'CRITICAL' ? critical : warning });
  };
  check('TEMPERATURE', values.temperature, e.temperatureWarning, e.temperatureCritical);
  check('PRESSURE', values.pressure, e.pressureWarning, e.pressureCritical);
  check('VIBRATION', values.vibration, e.vibrationWarning, e.vibrationCritical);
  return {
    status: alarms.some((a) => a.severity === 'CRITICAL')
      ? 'CRITICAL'
      : alarms.length
        ? 'WARNING'
        : 'NORMAL',
    alarms,
  };
}
export function alarmDescription(a: Alarm) {
  const meta = {
    TEMPERATURE: ['Температура', '°C'],
    PRESSURE: ['Давление', 'бар'],
    VIBRATION: ['Вибрация', 'мм/с'],
  }[a.type];
  return `${meta[0]} ${a.value.toFixed(2)} ${meta[1]}: превышен учебный порог ${a.threshold} ${meta[1]}.`;
}
