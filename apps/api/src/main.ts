import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import * as express from 'express';
import { AppModule } from './app.module';
import { CONFIG_TOKEN, type AppConfig } from './config/configuration';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get<AppConfig>(CONFIG_TOKEN);
  const logger = new Logger('Bootstrap');

  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

  // Capture the raw body so bridge HMAC signatures verify against the exact
  // bytes received, not a re-serialisation of the parsed object.
  app.use(
    express.json({
      limit: '8mb',
      verify: (req: express.Request & { rawBody?: string }, _res, buf) => {
        req.rawBody = buf.toString('utf8');
      },
    }),
  );

  app.enableCors({
    origin: config.corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      // Strip unknown keys rather than trusting them: several endpoints write
      // straight into Prisma, and tenancy fields must never be client-settable.
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  if (config.nodeEnv !== 'production') {
    const swagger = new DocumentBuilder()
      .setTitle('DevDNA SoftwareDNA API')
      .setDescription('Device verification for repair, refurbishment and resale businesses.')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, swagger));
  }

  app.enableShutdownHooks();
  await app.listen(config.port, '0.0.0.0');
  logger.log(
    `DevDNA API listening on :${config.port} (${config.nodeEnv})` +
      (config.devAuthBypass ? ' — AUTHENTICATION DISABLED (DEV_AUTH_BYPASS)' : ''),
  );
}

void bootstrap();
