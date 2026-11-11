-- CreateTable
CREATE TABLE "Equipment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NORMAL',
    "temperature" REAL NOT NULL,
    "pressure" REAL NOT NULL,
    "vibration" REAL,
    "temperatureBase" REAL NOT NULL,
    "pressureBase" REAL NOT NULL,
    "vibrationBase" REAL,
    "temperatureWarning" REAL NOT NULL,
    "temperatureCritical" REAL NOT NULL,
    "pressureWarning" REAL NOT NULL,
    "pressureCritical" REAL NOT NULL,
    "vibrationWarning" REAL,
    "vibrationCritical" REAL,
    "overheat" BOOLEAN NOT NULL DEFAULT false,
    "overpressure" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "TelemetryReading" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "equipmentId" TEXT NOT NULL,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "temperature" REAL NOT NULL,
    "pressure" REAL NOT NULL,
    "vibration" REAL,
    CONSTRAINT "TelemetryReading_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Incident" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "equipmentId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "occurredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedAt" DATETIME,
    "resolvedAt" DATETIME,
    "activeKey" TEXT,
    CONSTRAINT "Incident_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "TelemetryReading_equipmentId_timestamp_idx" ON "TelemetryReading"("equipmentId", "timestamp");

-- CreateIndex
CREATE INDEX "TelemetryReading_timestamp_idx" ON "TelemetryReading"("timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "Incident_activeKey_key" ON "Incident"("activeKey");

-- CreateIndex
CREATE INDEX "Incident_equipmentId_occurredAt_idx" ON "Incident"("equipmentId", "occurredAt");

-- CreateIndex
CREATE INDEX "Incident_status_occurredAt_idx" ON "Incident"("status", "occurredAt");

