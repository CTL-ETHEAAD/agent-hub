export type WorkerStatus = 'online' | 'stale' | 'offline';

export interface WorkerRegistration {
  id: string;
  pid: number | null;
  hostname: string;
  role: 'worker' | 'scheduler';
  capabilityTags: string[];
  concurrencySlots: number;
  status: WorkerStatus;
  registeredAt: string;
  heartbeatAt: string;
  leaseMs: number;
  activeNodeRunIds: string[];
}
