export type EquipmentStatus = 'NORMAL' | 'WARNING' | 'CRITICAL';
export type IncidentStatus = 'ACTIVE' | 'ACKNOWLEDGED' | 'RESOLVED';
export type Severity = 'WARNING' | 'CRITICAL';
export type FaultType = 'OVERHEAT' | 'OVERPRESSURE' | 'HIGH_VIBRATION' | 'COMBINED';
export type EventType = 'TEMPERATURE' | 'PRESSURE' | 'VIBRATION';
export interface Equipment {
  id: string;
  name: string;
  type: 'PUMP' | 'COMPRESSOR' | 'HEAT_EXCHANGER';
  location: string;
  description: string;
  status: EquipmentStatus;
  temperature: number;
  pressure: number;
  vibration: number | null;
  temperatureBase: number;
  pressureBase: number;
  vibrationBase: number | null;
  temperatureWarning: number;
  temperatureCritical: number;
  pressureWarning: number;
  pressureCritical: number;
  vibrationWarning: number | null;
  vibrationCritical: number | null;
  overheat: boolean;
  overpressure: boolean;
  highVibration: boolean;
  updatedAt: string;
}
export interface TelemetryReading {
  timestamp: string;
  temperature: number;
  pressure: number;
  vibration: number | null;
}
export interface Incident {
  id: string;
  equipmentId: string;
  equipment: Pick<Equipment, 'id' | 'name'>;
  type: EventType;
  description: string;
  severity: Severity;
  status: IncidentStatus;
  occurredAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
}
export interface SimulatorState {
  running: boolean;
  intervalMs: number;
  lastTickAt: string | null;
  error: string | null;
  mode?: 'background' | 'on-demand';
}
export interface Summary {
  total: number;
  normal: number;
  warning: number;
  critical: number;
  activeIncidents: number;
  unacknowledged: number;
  simulator: SimulatorState;
  maintenance: Record<WorkOrderStatus, number>;
}
export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
export interface Analytics {
  incidentsByType: { type: EventType; count: number }[];
  incidentsByEquipment: { id: string; count: number }[];
  incidentsBySeverity: { severity: Severity; count: number }[];
  totalReadings: number;
  totalIncidents: number;
  resolvedIncidents: number;
  from: string;
  to: string;
}
export interface ApiError {
  error: { code: string; message: string; details?: unknown };
}

export type WorkOrderStatus = 'OPEN' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
export type Priority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
export interface WorkOrder {
  id: string;
  equipmentId: string;
  title: string;
  description: string;
  priority: Priority;
  assignee: string;
  status: WorkOrderStatus;
  resolution: string;
  version: number;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  comments: { id: string; author: string; text: string; createdAt: string }[];
  history: { id: string; action: string; detail: string; createdAt: string }[];
}
export interface SessionInfo {
  mode: 'local' | 'demo';
  revision: string;
  resetReason: string | null;
  pollMs: number;
  expiresInSeconds: number | null;
  limits: {
    sessions: number;
    readingsPerEquipment: number;
    incidents: number;
    workOrders: number;
  } | null;
}
