import type { Equipment, Prisma } from '@prisma/client';
import type { Values } from '../domain/simulation.js';
import { evaluate, alarmDescription } from '../domain/simulation.js';
export async function persistReading(
  tx: Prisma.TransactionClient,
  e: Equipment,
  values: Values,
  time: Date,
) {
  const { status, alarms } = evaluate(e, values);
  const open = await tx.incident.findMany({
    where: { equipmentId: e.id, status: { not: 'RESOLVED' } },
  });
  for (const incident of open) {
    if (!alarms.some((a) => a.type === incident.type))
      await tx.incident.update({
        where: { id: incident.id },
        data: { status: 'RESOLVED', resolvedAt: time, activeKey: null },
      });
  }
  for (const alarm of alarms) {
    const previous = open.find((i) => i.type === alarm.type);
    if (!previous)
      await tx.incident.create({
        data: {
          equipmentId: e.id,
          type: alarm.type,
          severity: alarm.severity,
          description: alarmDescription(alarm),
          occurredAt: time,
          activeKey: `${e.id}:${alarm.type}`,
        },
      });
    else if (alarm.severity === 'CRITICAL' && previous.severity !== 'CRITICAL') {
      // A severity escalation needs fresh operator attention; preserve the same incident ID.
      await tx.incident.update({
        where: { id: previous.id },
        data: {
          severity: 'CRITICAL',
          status: 'ACTIVE',
          acknowledgedAt: null,
          description: alarmDescription(alarm),
        },
      });
    }
  }
  await tx.telemetryReading.create({ data: { equipmentId: e.id, timestamp: time, ...values } });
  return tx.equipment.update({ where: { id: e.id }, data: { ...values, status, updatedAt: time } });
}
