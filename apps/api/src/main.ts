import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configureApp } from './app-setup.js';
import { JsonLogger } from './common/json-logger.js';
import { loadRootEnv, requirePortEnv } from './common/env.js';

async function bootstrap(): Promise<void> {
  loadRootEnv();
  const port = requirePortEnv('API_PORT', 3001);
  const app = await NestFactory.create(AppModule, { logger: new JsonLogger() });
  configureApp(app);
  await app.listen(port);
}

bootstrap().catch((cause: unknown) => {
  process.stderr.write(
    `${JSON.stringify({
      time: new Date().toISOString(),
      level: 'fatal',
      context: 'bootstrap',
      message: cause instanceof Error ? cause.message : 'API failed to start.',
    })}\n`,
  );
  process.exitCode = 1;
});
