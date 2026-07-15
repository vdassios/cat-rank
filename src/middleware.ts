import { defineMiddleware } from 'astro:middleware';
import { issueToken, signToken, verifyToken, COOKIE_NAME, COOKIE_OPTS } from './lib/auth';

export const onRequest = defineMiddleware((context, next) => {
  const realIp = context.request.headers.get('X-Real-IP');
  context.locals.clientIp = realIp ?? context.clientAddress;

  const cookieValue = context.cookies.get(COOKIE_NAME)?.value;
  let token: string;

  if (cookieValue) {
    const verified = verifyToken(cookieValue);
    if (verified) {
      token = verified;
    } else {
      token = issueToken();
      context.cookies.set(COOKIE_NAME, signToken(token), COOKIE_OPTS);
    }
  } else {
    token = issueToken();
    context.cookies.set(COOKIE_NAME, signToken(token), COOKIE_OPTS);
  }

  context.locals.userToken = token;

  return next();
});
