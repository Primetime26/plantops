import { randomUUID } from 'node:crypto';
import type { EquipmentRecord } from '../domain/models.js';
import type { Values } from '../domain/simulation.js';
import { evaluate, alarmDescription } from '../domain/simulation.js';
import type { UnitOfWork } from '../storage/repository.js';
export async function persistReading(
  tx: UnitOfWork,
  e: EquipmentRecord,
  values: Values,
  time: Date,
) {
  const { status, alarms } = evaluate(e, values);
  const open = (await tx.incidents()).filter(
    (i) => i.equipmentId === e.id && i.status !== 'RESOLVED',
  );
  for (const i of open)
    if (!alarms.some((a) => a.type === i.type))
      await tx.saveIncident({ ...i, status: 'RESOLVED', resolvedAt: time, activeKey: null });
  for (const a of alarms) {
    const previous = open.find((i) => i.type === a.type);
    if (!previous)
      await tx.saveIncident({
        id: randomUUID(),
        equipmentId: e.id,
        type: a.type,
        severity: a.severity,
        description: alarmDescription(a),
        status: 'ACTIVE',
        occurredAt: time,
        acknowledgedAt: null,
        resolvedAt: null,
        activeKey: `${e.id}:${a.type}`,
      });
    else if (a.severity === 'CRITICAL' && previous.severity !== 'CRITICAL')
      await tx.saveIncident({
        ...previous,
        severity: 'CRITICAL',
        status: 'ACTIVE',
        acknowledgedAt: null,
        description: alarmDescription(a),
      });
  }
  const next = { ...e, ...values, status, updatedAt: time };
  await tx.appendReading({ equipmentId: e.id, timestamp: time, ...values });
  await tx.saveEquipment(next);
  return next;
}
