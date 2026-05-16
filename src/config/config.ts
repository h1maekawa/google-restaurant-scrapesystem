// src/config/config.ts

import 'dotenv/config';
import type { ScrapeConfig } from '../types';

function getEnv(key: string, defaultValue: string): string {
  return process.env[key] ?? defaultValue;
}

function getEnvFloat(key: string, defaultValue: number): number {
  const val = process.env[key];
  if (!val) return defaultValue;
  const parsed = parseFloat(val);
  return isNaN(parsed) ? defaultValue : parsed;
}

function getEnvInt(key: string, defaultValue: number): number {
  const val = process.env[key];
  if (!val) return defaultValue;
  const parsed = parseInt(val, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

export function loadConfig(): ScrapeConfig {
  const radiusKm  = getEnvFloat('RADIUS_KM', 0);
  const centerLat = getEnvFloat('CENTER_LAT', 0);
  const centerLng = getEnvFloat('CENTER_LNG', 0);

  const hasRadius = radiusKm > 0 && (centerLat !== 0 || centerLng !== 0);

  const rawCategories = getEnv('ALLOWED_CATEGORIES', '');
  const allowedCategories = rawCategories
    ? rawCategories.split(',').map(s => s.trim()).filter(Boolean)
    : [];

  const rawFormat = getEnv('OUTPUT_FORMAT', 'csv');
  const outputFormat = (['csv', 'json', 'both'] as const).includes(rawFormat as never)
    ? (rawFormat as 'csv' | 'json' | 'both')
    : 'csv';

  return {
    maxItems: getEnvInt('MAX_ITEMS', 100),
    allowedCategories,
    radiusFilter: hasRadius
      ? { centerLat, centerLng, radiusKm }
      : null,
    outputFormat,
    outputDir: getEnv('OUTPUT_DIR', './output'),
  };
}
