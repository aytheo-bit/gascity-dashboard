export type OperationsHomeStatus = 'ready' | 'blocked' | 'failed' | 'stale' | 'unknown';

export interface OperationsHomeStatusView {
  status: OperationsHomeStatus;
  icon: string;
  label: string;
}

export interface OperationsHomeAttentionItem extends OperationsHomeStatusView {
  kind: 'service' | 'readiness' | 'workstream';
  id: string;
  title: string;
  explanation: string;
}

export interface OperationsHomeService extends OperationsHomeStatusView {
  source: string;
  title: string;
  explanation: string;
  freshnessLabel: string;
}

export type OperationsHomeResponse =
  | {
      availability: 'available';
      schemaVersion: 1;
      mode: 'read-only';
      generatedAt: number;
      overall: OperationsHomeStatusView;
      needsAttention: OperationsHomeAttentionItem[];
      work: {
        countsTrusted: boolean;
        active: number | null;
        inFlight: number | null;
        reported: number | null;
        capacityLabel: string;
      };
      services: OperationsHomeService[];
      controls: [];
    }
  | {
      availability: 'unavailable';
      reason: 'snapshot-unavailable' | 'snapshot-invalid' | 'snapshot-stale';
      controls: [];
    };
