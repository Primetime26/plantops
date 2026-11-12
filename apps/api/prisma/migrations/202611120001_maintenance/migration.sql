ALTER TABLE "Equipment" ADD COLUMN "highVibration" BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE "WorkOrder" (
 "id" TEXT NOT NULL PRIMARY KEY, "equipmentId" TEXT NOT NULL, "title" TEXT NOT NULL,
 "description" TEXT NOT NULL, "priority" TEXT NOT NULL, "assignee" TEXT NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'OPEN', "resolution" TEXT NOT NULL DEFAULT '', "version" INTEGER NOT NULL DEFAULT 1,
 "archived" BOOLEAN NOT NULL DEFAULT false, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "completedAt" DATETIME,
 CONSTRAINT "WorkOrder_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "WorkOrder_equipmentId_status_idx" ON "WorkOrder"("equipmentId", "status");
CREATE TABLE "WorkOrderComment" (
 "id" TEXT NOT NULL PRIMARY KEY,"workOrderId" TEXT NOT NULL,"author" TEXT NOT NULL,"text" TEXT NOT NULL,"createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "WorkOrderComment_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE "WorkOrderHistory" (
 "id" TEXT NOT NULL PRIMARY KEY,"workOrderId" TEXT NOT NULL,"action" TEXT NOT NULL,"detail" TEXT NOT NULL,"createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "WorkOrderHistory_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
