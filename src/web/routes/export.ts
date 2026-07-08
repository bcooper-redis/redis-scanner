import { Router } from 'express';
import { toCsv, toIni, toOsstatsXlsx } from '../../export/index';
import type { AppState } from '../state';

export const exportRouter = Router();

exportRouter.get('/export/csv', (req, res) => {
  const state = req.app.get('state') as AppState;
  const { results } = state.getState();
  const csv = toCsv(results);
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="redis-scanner-export.csv"');
  res.send(csv);
});

exportRouter.get('/export/ini', (req, res) => {
  const state = req.app.get('state') as AppState;
  const { results } = state.getState();
  const ini = toIni(results);
  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Content-Disposition', 'attachment; filename="redis-scanner-export.ini"');
  res.send(ini);
});

exportRouter.get('/export/xlsx', (req, res) => {
  const state = req.app.get('state') as AppState;
  const { results } = state.getState();
  const xlsx = toOsstatsXlsx(results);
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
  res.setHeader('Content-Disposition', 'attachment; filename="redis-scanner-export.xlsx"');
  res.send(xlsx);
});
