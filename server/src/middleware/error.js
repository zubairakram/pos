import { ApiError } from '../utils.js';

export function notFound(req, res, next) {
  next(new ApiError(404, `Route not found: ${req.method} ${req.originalUrl}`));
}

export function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  let status = err.status || 500;
  let message = err.message;
  if (err.code === '23505') {
    status = 409;
    message = 'A record with that value already exists';
  } else if (err.code === '23503') {
    status = 400;
    message = 'That record is referenced by other data and cannot be changed';
  } else if (err.code === '22P02') {
    status = 400;
    message = 'Invalid value supplied';
  }
  if (status >= 500) console.error('[error]', err);
  res.status(status).json({
    error: status >= 500 ? 'Internal server error' : message,
    ...(err.details ? { details: err.details } : {}),
    ...(process.env.NODE_ENV === 'development' && status >= 500 ? { stack: err.stack } : {}),
  });
}
