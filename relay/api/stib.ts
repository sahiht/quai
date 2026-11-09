// GET /api/stib?points=5153,5154 : prochains passages STIB par arrêt (StibResponse).
import { defaultCtx } from '../lib/context.js';
import { handleStib } from '../lib/handlers.js';
import { preflight } from '../lib/http.js';

export function GET(request: Request): Promise<Response> {
  return handleStib(request, defaultCtx());
}

export function OPTIONS(): Response {
  return preflight();
}
