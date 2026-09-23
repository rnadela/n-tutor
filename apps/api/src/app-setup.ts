import { ValidationPipe, type INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { requireWebOrigin } from './common/env.js';

/** The one place the HTTP surface is configured, shared by runtime and tests. */
export function configureApp(app: INestApplication): INestApplication {
  app.setGlobalPrefix('api');
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
