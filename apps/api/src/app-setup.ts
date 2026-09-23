import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { optionalEnv } from './common/env.js';

/** The one place the HTTP surface is configured, shared by runtime and tests. */
export function configureApp(app: INestApplication): INestApplication {
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.enableCors({ origin: optionalEnv('WEB_ORIGIN', 'http://localhost:3000'), credentials: false });
  return app;
}
