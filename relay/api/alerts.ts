// GET /api/alerts?op=sncb|delijn|tec&routes=r1,r2&stops=s1 : alertes actives (AlertsResponse).
import { defaultCtx } from '../lib/context.js';
import { handleAlerts } from '../lib/handlers.js';
import { preflight } from '../lib/http.js';

export function GET(request: Request): Promise<Response> {
  return handleAlerts(request, defaultCtx());
}

export function OPTIONS(): Response {
  return preflight();
}
