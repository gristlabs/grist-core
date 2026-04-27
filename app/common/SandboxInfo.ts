/**
 * Information about the current sandbox environment.
 */
export interface SandboxInfo {
  flavor: string;       // the type of sandbox in use (gvisor, unsandboxed, etc)
  functional: boolean;  // whether the sandbox can run code
  effective: boolean;   // whether the sandbox is actually giving protection
  configured: boolean;  // whether a sandbox type has been specified
  // if sandbox fails to run, this records the last step that worked
  lastSuccessfulStep: "none" | "create" | "use" | "all";
  error?: string;       // if sandbox fails, this stores an error
  available?: boolean;  // whether the sandbox option is available on the current system
  unavailableReason?: string; // if not available, why
}

/**
 * Status of all sandbox providers on the server.
 */
export interface SandboxingStatus {
  options: SandboxInfo[];
  current?: string;             // Flavor currently running on the server
  flavorInEnv?: string;         // Flavor set via GRIST_SANDBOX_FLAVOR env var
  flavorInDB?: string;          // Flavor saved in DB (takes effect after restart)
}
