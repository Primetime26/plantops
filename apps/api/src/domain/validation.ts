import { z } from 'zod';
export const equipmentId = z.string().regex(/^[A-Z]-\d{3}$/, 'Неверный ID оборудования');
export const id = z.string().min(1).max(80);
export const status = z.enum(['NORMAL', 'WARNING', 'CRITICAL']);
export const orderStatus = z.enum(['OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']);
export const priority = z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']);
export const period = z
  .object({ minutes: z.coerce.number().int().min(1).max(1440).default(15) })
  .strict();
export const incidentQuery = z
  .object({
    equipmentId: equipmentId.optional(),
    status: z.enum(['ACTIVE', 'ACKNOWLEDGED', 'RESOLVED']).optional(),
    severity: z.enum(['WARNING', 'CRITICAL']).optional(),
    page: z.coerce.number().int().min(1).max(100000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();
export const orderQuery = z
  .object({
    equipmentId: equipmentId.optional(),
    status: orderStatus.optional(),
    priority: priority.optional(),
    search: z.string().max(100).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();
const text = (min: number, max: number) => z.string().trim().min(min).max(max);
export const createOrder = z
  .object({
    equipmentId,
    title: text(3, 120),
    description: text(5, 2000),
    priority: priority.default('MEDIUM'),
    assignee: text(1, 80),
  })
  .strict();
export const updateOrder = z
  .object({
    version: z.number().int().positive(),
    title: text(3, 120).optional(),
    description: text(5, 2000).optional(),
    priority: priority.optional(),
    assignee: text(1, 80).optional(),
    status: orderStatus.optional(),
    resolution: text(0, 2000).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 1, 'Укажите изменения');
export const commentInput = z
  .object({ version: z.number().int().positive(), author: text(1, 80), text: text(1, 1000) })
  .strict();
