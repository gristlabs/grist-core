
export type BootProbeIds =
    'boot-page' |
    'health-check' |
    'reachable' |
    'host-header' |
    'system-user'
;

export interface BootProbeResult {
  verdict?: string;
  success?: boolean;
  done?: boolean;
  severity?: 'fault' | 'warning' | 'hmm';
  details?: Record<string, any>;
}

export interface BootProbeInfo {
  id: BootProbeIds;
  name: string;
}

