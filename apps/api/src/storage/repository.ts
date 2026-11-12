import type { EquipmentRecord, IncidentRecord, OrderRecord, Reading } from '../domain/models.js';
export interface UnitOfWork {
  equipment(): Promise<EquipmentRecord[]>;
  saveEquipment(value: EquipmentRecord): Promise<void>;
  incidents(): Promise<IncidentRecord[]>;
  saveIncident(value: IncidentRecord): Promise<void>;
  readings(id: string, from: Date, to: Date): Promise<Reading[]>;
  countReadings(from: Date, to: Date): Promise<number>;
  appendReading(value: Reading): Promise<void>;
  orders(details?: boolean): Promise<OrderRecord[]>;
  order(id: string): Promise<OrderRecord | null>;
  saveOrder(value: OrderRecord): Promise<void>;
}
export interface Repository {
  read<T>(work: (tx: UnitOfWork) => Promise<T>): Promise<T>;
  transaction<T>(work: (tx: UnitOfWork) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
