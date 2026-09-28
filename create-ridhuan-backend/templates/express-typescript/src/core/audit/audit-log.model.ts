/**
 * Shape of a persistent activity record.
 * Maps to the ActivityLog Prisma model.
 */
export interface ActivityLogRecord {
  id: string;
  behavior: string;
  module: string;
  entityId: string | null;
  userId: string | null;
  actorIdSnapshot: string | null;
  before: unknown;
  after: unknown;
  requestId: string | null;
  endpointId: string | null;
  createdAt: Date;
}
