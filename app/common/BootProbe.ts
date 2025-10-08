import { SandboxInfo } from 'app/common/SandboxInfo';

export type BootProbeIds =
    'admins' |
    'boot-page' |
    'health-check' |
    'reachable' |
    'host-header' |
    'sandboxing' |
    'system-user' |
    'authentication' |
    'websockets' |
    'session-secret'
;

export interface BootProbeResult {
  verdict?: string;
  // Result of check.
  // "success" is a positive outcome.
  // "none" means no fault detected (but that the test is not exhaustive
  // enough to claim "success").
  // "fault" is a bad error, "warning" a ... warning, "hmm" almost a debug message.
  status: 'success' | 'fault' | 'warning' | 'hmm' | 'none';
  details?: Record<string, any>;
}

export interface BootProbeInfo {
  id: BootProbeIds;
  name: string;
}

export type SandboxingBootProbeDetails = SandboxInfo;
