export type NodePortKind = 'none' | 'control' | 'branch';
export type NodeRisk = 'model' | 'external-side-effect' | 'human-gate' | 'repository-write';

export interface NodeContract {
  type: string;
  inputPort: NodePortKind;
  outputPort: NodePortKind;
  minIncoming: number;
  maxOutgoing: number;
  configurableInput?: boolean;
  risk?: NodeRisk;
}

export interface ContractDiagnostic {
  path: string;
  message: string;
  source: 'node-contract-v1';
}

export interface WorkflowContractAnalysis {
  version: 1;
  errors: ContractDiagnostic[];
  warnings: ContractDiagnostic[];
}
