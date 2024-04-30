export interface SandboxInfo {
  flavor: string;       // the type of sandbox in use (gvisor, unsandboxed, etc)
  functional: boolean;  // whether the sandbox can run code
  effective: boolean;   // whether the sandbox is actually giving protection
  configured: boolean;  // whether a sandbox type has been specified
  // if sandbox fails to run, this records the last step that worked
  lastSuccessfulStep: 'none' | 'create' | 'use' | 'all';
  error?: string;       // if sandbox fails, this stores an error
}
