// GET /api/health : état des sources et des données de nuit (HealthResponse).
import { defaultCtx } from '../lib/context.js';
import { handleHealth } from '../lib/handlers.js';
import { preflight } from '../lib/http.js';

export function GET(request: Request): Promise<Response> {
  return handleHealth(request, defaultCtx());
}

export function OPTIONS(): Response {
  return preflight();
}
