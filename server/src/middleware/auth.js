import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { query } from '../db/index.js';
import { ApiError } from '../utils.js';

export function signToken(user) {
  return jwt.sign(
    { id: user.id, role: user.role, location_id: user.location_id },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn }
  );
}

export async function authenticate(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw new ApiError(401, 'Authentication required');
    let payload;
    try {
      payload = jwt.verify(token, config.jwtSecret);
    } catch {
      throw new ApiError(401, 'Session expired or invalid token');
    }
    const { rows } = await query(
      `SELECT u.id, u.name, u.email, u.role, u.location_id, u.is_active, l.name AS location_name
       FROM users u LEFT JOIN locations l ON l.id = u.location_id WHERE u.id = $1`,
      [payload.id]
    );
    if (!rows.length || !rows[0].is_active) throw new ApiError(401, 'User account is not active');
    req.user = rows[0];
    next();
  } catch (err) {
    next(err);
  }
}

export const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) return next(new ApiError(401, 'Authentication required'));
  if (!roles.includes(req.user.role)) {
    return next(new ApiError(403, 'You do not have permission to perform this action'));
  }
  next();
};

export const requireAnyOf = requireRole;
