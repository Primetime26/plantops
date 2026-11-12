import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type { WorkOrderStatus } from '@plantops/contracts';
import type { Repository, UnitOfWork } from '../storage/repository.js';
import type { OrderRecord } from '../domain/models.js';
import type { createOrder, updateOrder, commentInput } from '../domain/validation.js';
import { getEquipment } from './simulator.js';
import { AppError } from '../errors.js';
const transitions: Record<WorkOrderStatus, WorkOrderStatus[]> = {
  OPEN: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};
export function assertTransition(from: WorkOrderStatus, to: WorkOrderStatus) {
  if (from !== to && !transitions[from].includes(to))
    throw new AppError(409, 'INVALID_TRANSITION', `Недопустимый переход ${from} → ${to}`);
}
async function find(tx: UnitOfWork, id: string) {
  const order = await tx.order(id);
  if (!order || order.archived) throw new AppError(404, 'NOT_FOUND', 'Заявка не найдена');
  return order;
}
function version(order: OrderRecord, v: number) {
  if (order.version !== v)
    throw new AppError(
      409,
      'VERSION_CONFLICT',
      'Заявка изменена другим запросом. Обновите данные.',
    );
}
function event(order: OrderRecord, action: string, detail: string, now: Date) {
  return {
    ...order,
    version: order.version + 1,
    updatedAt: now,
    history: [...order.history, { id: randomUUID(), action, detail, createdAt: now }],
  };
}
export class MaintenanceService {
  constructor(
    private repository: Repository,
    private now = () => new Date(),
  ) {}
  create(input: z.infer<typeof createOrder>) {
    return this.repository.transaction(async (tx) => {
      await getEquipment(tx, input.equipmentId);
      if ((await tx.orders(false)).length >= 1000)
        throw new AppError(409, 'LIMIT', 'Лимит заявок достигнут');
      const now = this.now();
      const order: OrderRecord = {
        ...input,
        id: randomUUID(),
        status: 'OPEN',
        resolution: '',
        version: 1,
        archived: false,
        createdAt: now,
        updatedAt: now,
        completedAt: null,
        comments: [],
        history: [
          { id: randomUUID(), action: 'CREATED', detail: 'Заявка создана', createdAt: now },
        ],
      };
      await tx.saveOrder(order);
      return order;
    });
  }
  update(id: string, input: z.infer<typeof updateOrder>) {
    return this.repository.transaction(async (tx) => {
      const order = await find(tx, id);
      version(order, input.version);
      if (['COMPLETED', 'CANCELLED'].includes(order.status))
        throw new AppError(409, 'CLOSED_ORDER', 'Завершённую заявку нельзя редактировать');
      const { version: _version, ...changes } = input;
      const next = { ...order, ...changes };
      assertTransition(order.status, next.status);
      if (next.status === 'COMPLETED') {
        if (next.resolution.trim().length < 5)
          throw new AppError(
            422,
            'RESOLUTION_REQUIRED',
            'Опишите выполненные работы (от 5 символов)',
          );
        if ((await getEquipment(tx, next.equipmentId)).status !== 'NORMAL')
          throw new AppError(
            409,
            'EQUIPMENT_UNHEALTHY',
            'Сначала восстановите нормальный режим оборудования',
          );
        next.completedAt = this.now();
      }
      if (next.status === 'CANCELLED' && next.resolution.trim().length < 5)
        throw new AppError(422, 'REASON_REQUIRED', 'Укажите причину отмены (от 5 символов)');
      const labels: Record<string, string> = {
        title: 'Название',
        description: 'Описание',
        priority: 'Приоритет',
        assignee: 'Ответственный',
        status: 'Статус',
        resolution: 'Результат',
      };
      const names: Record<string, string> = {
        OPEN: 'Открыта',
        IN_PROGRESS: 'В работе',
        COMPLETED: 'Выполнена',
        CANCELLED: 'Отменена',
        LOW: 'Низкий',
        MEDIUM: 'Средний',
        HIGH: 'Высокий',
        URGENT: 'Срочный',
      };
      const detail = Object.entries(changes)
        .map(([key, raw]) => {
          const value = names[String(raw)] ?? raw;
          return `${labels[key] ?? key}: ${String(value).slice(0, 120)}${String(value).length > 120 ? '…' : ''}`;
        })
        .join('; ');
      const saved = event(next, 'UPDATED', detail, this.now());
      await tx.saveOrder(saved);
      return (await tx.order(id))!;
    });
  }
  comment(id: string, input: z.infer<typeof commentInput>) {
    return this.repository.transaction(async (tx) => {
      const order = await find(tx, id);
      version(order, input.version);
      if (['COMPLETED', 'CANCELLED'].includes(order.status))
        throw new AppError(409, 'CLOSED_ORDER', 'Заявка закрыта');
      if (order.comments.length >= 30)
        throw new AppError(409, 'LIMIT', 'Лимит 30 комментариев на заявку');
      const now = this.now();
      const next = event(
        {
          ...order,
          comments: [
            ...order.comments,
            { id: randomUUID(), author: input.author, text: input.text, createdAt: now },
          ],
        },
        'COMMENTED',
        `Комментарий: ${input.author}`,
        now,
      );
      await tx.saveOrder(next);
      return (await tx.order(id))!;
    });
  }
  archive(id: string, v: number) {
    return this.repository.transaction(async (tx) => {
      const order = await find(tx, id);
      version(order, v);
      if (!['COMPLETED', 'CANCELLED'].includes(order.status))
        throw new AppError(409, 'INVALID_TRANSITION', 'Архивировать можно только закрытую заявку');
      const next = event(
        { ...order, archived: true },
        'ARCHIVED',
        'Заявка архивирована',
        this.now(),
      );
      await tx.saveOrder(next);
      return (await tx.order(id))!;
    });
  }
}
