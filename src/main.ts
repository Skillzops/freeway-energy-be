import { NestFactory, Reflector } from '@nestjs/core';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ClassSerializerInterceptor, RequestMethod, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);

  app.setGlobalPrefix('api/v1', {
    exclude: [{ path: 'api/payments/odyssey', method: RequestMethod.ALL }],
  });

  const allowedOrigins = configService.get<string>('ALLOWED_ORIGINS') || '*';

  app.enableCors({
    origin: allowedOrigins,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    preflightContinue: false,
    optionsSuccessStatus: 204,
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      // forbidNonWhitelisted: true,
      // transform: true,
      // transformOptions: { enableImplicitConversion: true },
    }),
  );

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

  // Sort the paths in ascending order
  document.paths = Object.keys(document.paths)
    .sort()
    .reduce((sortedPaths, key) => {
      sortedPaths[key] = document.paths[key];
      return sortedPaths;
    }, {});

  SwaggerModule.setup('api-docs', app, document);

  app.useGlobalFilters();
  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));

  // Enable validation globally
  app.useGlobalPipes(new ValidationPipe());

  await app.listen(configService.get<number>('PORT') || 3000);
}
bootstrap();
