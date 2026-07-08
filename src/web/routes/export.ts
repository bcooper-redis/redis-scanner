import { Router } from 'express';
import { toCsv, toIni, toOsstatsXlsx } from '../../export/index';
import { dedupeByRunId } from '../../types';
import type { DiscoveryResult } from '../../types';
import type { AppState } from '../state';

export const exportRouter = Router();

/** Mirrors the Results page's "Hide duplicates" checkbox for exports triggered from it. */
function selectResults(req: { query: unknown }, state: AppState): DiscoveryResult[] {
  const { results } = state.getState();
  const query = req.query as { excludeDuplicates?: string };
  return query.excludeDuplicates === 'true' ? dedupeByRunId(results) : results;
}

exportRouter.get('/export/csv', (req, res) => {
  const state = req.app.get('state') as AppState;
  const csv = toCsv(selectResults(req, state));
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="redis-discovery-export.csv"');
  res.send(csv);
});

exportRouter.get('/export/ini', (req, res) => {
  const state = req.app.get('state') as AppState;
  const ini = toIni(selectResults(req, state));
  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Content-Disposition', 'attachment; filename="redis-discovery-export.ini"');
  res.send(ini);
});

exportRouter.get('/export/xlsx', (req, res) => {
  const state = req.app.get('state') as AppState;
  const xlsx = toOsstatsXlsx(selectResults(req, state));
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
  res.setHeader('Content-Disposition', 'attachment; filename="redis-discovery-export.xlsx"');
  res.send(xlsx);
});
