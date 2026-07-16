import type { FilesystemPermission, NetworkPermission } from './agent.js';
import type { VersionedAsset } from './common.js';

export type PolicyEffect = 'allow' | 'deny' | 'requires_approval';

export interface PolicyScope {
  agents?: string[];
  workflows?: string[];
  tools?: string[];
}

export interface SandboxPolicy {
  mode: 'none' | 'process' | 'isolated-worktree' | 'container';
  filesystem: FilesystemPermission;
  network: NetworkPermission;
  gitWrite: boolean;
  worktreeStrategy?: 'shared' | 'fresh-per-run';
}

export interface PolicyDefinition extends VersionedAsset {
  scope: PolicyScope;
  sandbox: SandboxPolicy;
  tools: { allow: string[]; deny: string[] };
  actions: Record<string, PolicyEffect>;
  promptInjection: {
    wrapExternalContent: boolean;
    denyInstructionOverride: boolean;
  };
}

export interface PolicyDecision {
  effect: PolicyEffect;
  reason: string;
  policyId?: string;
  policyVersion?: number;
  risk: 'low' | 'medium' | 'high' | 'critical';
}
