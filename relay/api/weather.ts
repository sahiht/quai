// GET /api/weather : pluie prévue sur une grille fixe de la Belgique (WeatherResponse), sans aucune position.
import { defaultCtx } from '../lib/context.js';
import { handleWeather } from '../lib/handlers.js';
import { preflight } from '../lib/http.js';

export function GET(request: Request): Promise<Response> {
  return handleWeather(request, defaultCtx());
}

export function OPTIONS(): Response {
  return preflight();
}
