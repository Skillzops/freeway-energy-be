import { NestFactory, Reflector } from '@nestjs/core';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import {
  ClassSerializerInterceptor,
  RequestMethod,
  ValidationPipe,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { HttpAdapterHost } from '@nestjs/core';
import { AuditInterceptor } from './common/interceptors/audit.interceptor';
import { AuditLogService } from './audit-log/audit-log.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);
  const httpAdapterHost = app.get(HttpAdapterHost);
  const logger = new Logger('Bootstrap');

  // Global API prefix
  app.setGlobalPrefix('api/v1', {
    exclude: [{ path: 'api/payments/odyssey', method: RequestMethod.ALL }],
  });

  // CORS configuration
  const allowedOrigins = configService.get<string>('ALLOWED_ORIGINS') || '*';
  app.enableCors({
    origin: allowedOrigins,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    preflightContinue: false,
    optionsSuccessStatus: 204,
    credentials: true,
  });

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      // forbidNonWhitelisted: true,
      // transform: true,
      // transformOptions: { enableImplicitConversion: true },
    }),
  );

  const auditLogService = app.get(AuditLogService);

  // Global exception filter
  app.useGlobalFilters(new AllExceptionsFilter(httpAdapterHost));

  // Global interceptors
  app.useGlobalInterceptors(
    new ClassSerializerInterceptor(app.get(Reflector)),
    new AuditInterceptor(auditLogService),
  );

  // Swagger/OpenAPI documentation
  const config = new DocumentBuilder()
    .setTitle('Energy Project Backend')
    .setDescription('APIs for the Energy Project.')
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'Authorization',
        description: 'JWT Authorization header using the Bearer scheme.',
        in: 'header',
      },
      'access_token',
    )
    .addSecurityRequirements('bearer')
    .build();

  const document = SwaggerModule.createDocument(app, config);

  // Sort paths in ascending order
  document.paths = Object.keys(document.paths)
    .sort()
    .reduce((sortedPaths, key) => {
      sortedPaths[key] = document.paths[key];
      return sortedPaths;
    }, {});

  SwaggerModule.setup('api-docs', app, document);

  // Handle uncaught exceptions
  process.on('unhandledRejection', (reason: Error, promise: Promise<any>) => {
    logger.error(
      `Unhandled Rejection at: ${promise} reason: ${reason.message}`,
      reason.stack,
    );
  });

  process.on('uncaughtException', (error: Error) => {
    logger.error(`Uncaught Exception: ${error.message}`, error.stack);
    // Optionally gracefully shutdown
    // process.exit(1);
  });

  const port = configService.get<number>('PORT') || 3000;
  const host = configService.get<string>('HOST') || '0.0.0.0';

  // await app.listen(port, host);
  await app.listen(port);
  logger.log(`Application is running on ${host}:${port}`);
}

bootstrap();
