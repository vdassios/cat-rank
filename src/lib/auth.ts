import crypto from 'node:crypto';
import { sign as cookieSign, unsign as cookieUnsign } from 'cookie-signature';

if (!process.env.HMAC_SECRET) {
  throw new Error('HMAC_SECRET environment variable is required');
}

const SECRET: string = process.env.HMAC_SECRET;

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
