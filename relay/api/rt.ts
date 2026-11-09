// GET /api/rt?op=sncb|delijn|tec&trips=t1,t2 : mises à jour GTFS-RT des voyages demandés (RtResponse).
import { defaultCtx } from '../lib/context.js';
import { handleRt } from '../lib/handlers.js';
import { preflight } from '../lib/http.js';

export function GET(request: Request): Promise<Response> {
  return handleRt(request, defaultCtx());
}

export function OPTIONS(): Response {
  return preflight();
}
