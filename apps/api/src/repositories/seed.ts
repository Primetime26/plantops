import type { PrismaClient } from '@prisma/client';
import { seedEquipment } from '../domain/equipment.js';
export async function seed(db: PrismaClient) {
  // Existing operating state and history are intentionally untouched.
  await db.$transaction(async (tx) => {
    for (const data of seedEquipment) {
      const exists = await tx.equipment.findUnique({ where: { id: data.id } });
      if (!exists) {
        await tx.equipment.create({ data });
        await tx.telemetryReading.create({
          data: {
            equipmentId: data.id,
            temperature: data.temperature,
            pressure: data.pressure,
            vibration: data.vibration,
          },
        });
      }
    }
  });
}
