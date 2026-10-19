import { randomUUID } from 'node:crypto';
import { Request, Response, NextFunction } from 'express';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      traceId: string;
    }
  }
}

// Читает X-Trace-Id от клиента (фронтенд генерирует один на каждый вызов
// /support) или создаёт новый — так каждый запрос можно сопоставить в логах
// frontend/backend/ML-сервиса.
export function traceIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const traceId = req.header('x-trace-id') || randomUUID();
  req.traceId = traceId;
  res.setHeader('X-Trace-Id', traceId);
  next();
}

// Одна структурированная строка на важное событие — не дамп всего объекта.
export function log(traceId: string, message: string, extra?: Record<string, unknown>): void {
  const extraStr = extra
    ? ' ' + Object.entries(extra).map(([key, value]) => `${key}=${value}`).join(' ')
    : '';
  console.log(`[${traceId}] ${message}${extraStr}`);
}
