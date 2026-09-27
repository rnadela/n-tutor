import { ValidationPipe, type INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { requireWebOrigin } from './common/env.js';
import { MAX_JSON_BODY_BYTES } from './practicetest/practice-test-policy.js';

/** The one place the HTTP surface is configured, shared by runtime and tests. */
export function configureApp(app: INestApplication): INestApplication {
  app.setGlobalPrefix('api');
  // Raised from Express's 100KB default, to a figure computed from the one body that
  // can legitimately exceed it: a child handing in a full paper. Left at the default,
  // the largest submission the DTO allows is refused by the transport before
  // validation ever sees it — a 413 the screen can only read as a generic failure, so
  // the child re-presses Hand in forever and the work is never accepted. Applied
  // here, in the config both the runtime and the integration suite share, so the
  // suite exercises the same ceiling the product runs with.
  //
  // Page images are not affected: an upload is multipart and goes through its own
  // parser with its own, much larger, byte ceiling.
  (app as NestExpressApplication).useBodyParser('json', { limit: MAX_JSON_BODY_BYTES });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  // The parent session is a cookie, so it has to be parsed here — the one
  // config the integration suite shares with the runtime — and CORS has to
  // allow credentials against an exact origin, never a wildcard.
  app.use(cookieParser());
  app.enableCors({ origin: requireWebOrigin(), credentials: true });
  return app;
}
