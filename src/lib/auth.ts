import crypto from 'node:crypto';
import { sign as cookieSign, unsign as cookieUnsign } from 'cookie-signature';

function resolveSecret(): string {
  if (process.env.HMAC_SECRET) return process.env.HMAC_SECRET;
  if (process.env.LOCAL_DEV === '1') return 'local-dev-insecure';
  throw new Error('HMAC_SECRET environment variable is required');
}

const SECRET: string = resolveSecret();

export function issueToken(): string {
  return crypto.randomUUID();
}

export function signToken(token: string): string {
  return cookieSign(token, SECRET);
}

export function verifyToken(signed: string): string | false {
  return cookieUnsign(signed, SECRET);
}

export function createIpUaHash(ip: string, userAgent: string): string {
  return crypto.createHash('sha256').update(`${ip}|${userAgent}`).digest('hex').slice(0, 32);
}

export const COOKIE_NAME = 'user_token';

export const COOKIE_OPTS = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 31536000,
};
