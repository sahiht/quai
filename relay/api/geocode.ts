// GET /api/geocode?q=texte&lang=fr|nl : adresses des services officiels des trois Régions (GeocodeResponse).
import { defaultCtx } from '../lib/context.js';
import { handleGeocode } from '../lib/geocode/service.js';
import { preflight } from '../lib/http.js';

export function GET(request: Request): Promise<Response> {
  return handleGeocode(request, defaultCtx());
}

export function OPTIONS(): Response {
  return preflight();
}
