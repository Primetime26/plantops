import { describe, expect, it } from 'vitest';
import { seedEquipment } from '../src/domain/equipment.js';
import type { EquipmentRecord } from '../src/domain/models.js';
import { evaluate, nextValues } from '../src/domain/simulation.js';
import { assertTransition } from '../src/services/maintenance.js';
import { createOrder, updateOrder, period, commentInput } from '../src/domain/validation.js';
import { csv } from '../src/services/csv.js';
import type { WorkOrderStatus } from '@plantops/contracts';
const equipment: EquipmentRecord = {
  ...seedEquipment[0],
  status: 'NORMAL',
  overheat: false,
  overpressure: false,
  highVibration: false,
  updatedAt: new Date(0),
};
const normal = {
  temperature: equipment.temperatureBase,
  pressure: equipment.pressureBase,
  vibration: equipment.vibrationBase,
};
describe('deterministic simulation and boundaries', () => {
  for (const [metric, warning, critical] of [
    ['temperature', equipment.temperatureWarning, equipment.temperatureCritical],
    ['pressure', equipment.pressureWarning, equipment.pressureCritical],
    ['vibration', equipment.vibrationWarning!, equipment.vibrationCritical!],
  ] as const) {
    it.each([
      [warning - 0.01, 'NORMAL'],
      [warning, 'WARNING'],
      [critical - 0.01, 'WARNING'],
      [critical, 'CRITICAL'],
    ] as const)(`${metric} at %s → %s`, (value, status) =>
      expect(evaluate(equipment, { ...normal, [metric]: value }).status).toBe(status),
    );
  }
  it('uses highest severity and independent alarms', () => {
    const result = evaluate(equipment, {
      temperature: equipment.temperatureCritical,
      pressure: equipment.pressureWarning,
      vibration: equipment.vibrationCritical,
    });
    expect(result.status).toBe('CRITICAL');
    expect(result.alarms).toHaveLength(3);
  });
  it('does not create an artificial vibration sensor', () => {
    const e = {
      ...equipment,
      ...seedEquipment.find((e) => e.id === 'T-301')!,
      highVibration: true,
    };
    expect(nextValues(e, new Date(0)).vibration).toBeNull();
    expect(
      evaluate(e, {
        ...normal,
        temperature: e.temperatureBase,
        pressure: e.pressureBase,
        vibration: 100,
      }).alarms,
    ).toHaveLength(0);
  });
  it('reproduces combined faults and recovers to a bounded normal range', () => {
    let a = { ...equipment, overheat: true, overpressure: true, highVibration: true },
      b = { ...a };
    for (let i = 0; i < 10; i++) {
      const time = new Date(i * 5000);
      a = { ...a, ...nextValues(a, time) };
      b = { ...b, ...nextValues(b, time) };
      expect(a).toEqual(b);
    }
    expect(evaluate(a, a).alarms).toHaveLength(3);
    a = { ...a, overheat: false, overpressure: false, highVibration: false };
    for (let i = 0; i < 100; i++) a = { ...a, ...nextValues(a, new Date(i * 5000)) };
    expect(evaluate(a, a).status).toBe('NORMAL');
  });
  it('keeps normal conditions within bounds for every equipment type', () => {
    for (const seed of seedEquipment) {
      let e = { ...equipment, ...seed };
      for (let n = 0; n < 1200; n++) {
        e = { ...e, ...nextValues(e, new Date(n * 5000)) };
        expect(evaluate(e, e).status).toBe('NORMAL');
      }
    }
  });
});
describe('maintenance transitions and validation', () => {
  const states: WorkOrderStatus[] = ['OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];
  const allowed = [
    'OPEN:IN_PROGRESS',
    'OPEN:CANCELLED',
    'IN_PROGRESS:COMPLETED',
    'IN_PROGRESS:CANCELLED',
  ];
  for (const from of states)
    for (const to of states)
      it(`${from} → ${to}`, () => {
        if (from === to || allowed.includes(`${from}:${to}`))
          expect(() => assertTransition(from, to)).not.toThrow();
        else expect(() => assertTransition(from, to)).toThrow();
      });
  it('validates strict input, trimmed text, versions and bounded periods', () => {
    const good = {
      equipmentId: 'H-101',
      title: ' Проверка ',
      description: 'Проверка уплотнения',
      assignee: 'Механик',
    };
    expect(createOrder.parse(good).title).toBe('Проверка');
    for (const bad of [
      { ...good, title: ' ' },
      { ...good, extra: true },
      { ...good, equipmentId: 1 },
      { ...good, description: 'x'.repeat(2001) },
    ])
      expect(createOrder.safeParse(bad).success).toBe(false);
    expect(updateOrder.safeParse({ version: 1 }).success).toBe(false);
    expect(updateOrder.safeParse({ version: '1', status: 'COMPLETED' }).success).toBe(false);
    expect(period.safeParse({ minutes: 1441 }).success).toBe(false);
    expect(commentInput.safeParse({ version: 1, author: 'ОП', text: ' ' }).success).toBe(false);
  });
  it('escapes CSV quotes, newlines, Unicode and spreadsheet formulas', () => {
    const text = csv([['=1+1', ' @SUM(A1)', '-cmd', 'a"b', 'line\nline', 'Насос', null]]);
    expect(text.startsWith('\uFEFF')).toBe(true);
    expect(text).toContain('"\'=1+1"');
    expect(text).toContain('"\' @SUM(A1)"');
    expect(text).toContain('"a""b"');
    expect(text).toContain('"line\nline"');
  });
});
