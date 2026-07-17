export type WorkerStatus = 'online' | 'stale' | 'offline';

export interface WorkerRegistration {
  id: string;
  pid: number | null;
  hostname: string;
  role: 'worker' | 'scheduler';
  capabilityTags: string[];
  attestation: WorkerAttestation;
  concurrencySlots: number;
  status: WorkerStatus;
  registeredAt: string;
  heartbeatAt: string;
  leaseMs: number;
  activeNodeRunIds: string[];
}

export interface WorkerAttestation {
  subject: string;
  issuer: string;
  issuedAt: string;
  expiresAt: string | null;
  capabilityTags: string[];
  signature: string;
  verified: boolean;
}
