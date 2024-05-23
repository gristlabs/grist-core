import { getCoreLoginSystem } from "app/server/lib/coreLogins";
import { GristLoginSystem } from "app/server/lib/GristServer";

export async function getLoginSystem(): Promise<GristLoginSystem> {
  return getCoreLoginSystem();
}
