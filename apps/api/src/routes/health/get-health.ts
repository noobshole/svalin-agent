import { apiStatus } from "../../config/api-status.js";

export function getHealthRoute() {
  return {
    ...apiStatus,
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  };
}
