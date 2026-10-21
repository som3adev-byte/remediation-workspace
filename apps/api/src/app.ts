import 'reflect-metadata';
import { type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { json } from 'express';
import { AppModule } from './app.module';
import { requestContext } from './common/request-context';
import { env } from './config/env';

/** Builds the app with the same settings for `main.ts` and for the tests. */
export async function createApp(): Promise<INestApplication> {
  env(); // fail fast on bad configuration
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: false, bodyParser: false });
  // Exactly one trusted hop: the web proxy. req.ip is the client IP the proxy reported
  // in X-Forwarded-For (ProxySecretGuard rejects anything that did not come through it).
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(requestContext);
  app.use(json({ limit: '32kb' }));
  app.use(cookieParser());
  return app;
}
