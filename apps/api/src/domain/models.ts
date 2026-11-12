import type { Equipment, Incident, WorkOrder } from '@plantops/contracts';
export type EquipmentRecord = Omit<Equipment, 'updatedAt'> & { updatedAt: Date };
export type IncidentRecord = Omit<
  Incident,
  'equipment' | 'occurredAt' | 'acknowledgedAt' | 'resolvedAt'
> & {
  occurredAt: Date;
  acknowledgedAt: Date | null;
  resolvedAt: Date | null;
  activeKey: string | null;
};
export interface Reading {
  equipmentId: string;
  timestamp: Date;
  temperature: number;
  pressure: number;
  vibration: number | null;
}
export type OrderRecord = Omit<
  WorkOrder,
  'createdAt' | 'updatedAt' | 'completedAt' | 'comments' | 'history'
> & {
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  comments: { id: string; author: string; text: string; createdAt: Date }[];
  history: { id: string; action: string; detail: string; createdAt: Date }[];
};
