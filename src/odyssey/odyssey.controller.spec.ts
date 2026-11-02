import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as request from 'supertest';
import { OdysseyController } from './odyssey.controller';
import { OdysseyService } from './odyssey.service';

describe('Odyssey payment route', () => {
  let app: INestApplication;
  const service = {
    validateApiToken: jest.fn().mockResolvedValue(true),
    getPayments: jest.fn().mockResolvedValue({ payments: [], errors: null }),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [OdysseyController],
      providers: [{ provide: OdysseyService, useValue: service }],
    }).compile();

    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
  });

  afterAll(async () => { await app.close(); });

  it('serves partner payments at /api/v1/payments', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/payments')
      .set('Authorization', 'Bearer test-partner-key')
      .query({ FROM: '2026-11-01T00:00:00Z', TO: '2026-11-02T00:00:00Z' })
      .expect(200)
      .expect({ payments: [], errors: null });
    expect(service.validateApiToken).toHaveBeenCalledWith('test-partner-key');
  });

  it('still requires bearer authentication', async () => {
    await request(app.getHttpServer()).get('/api/v1/payments').expect(401);
  });

  it.each(['/api/payments/odyssey', '/api/v1/api/payments/odyssey', '/api/v1/payments/odyssey'])(
    'does not expose an alias at %s', async (path) => {
      await request(app.getHttpServer()).get(path).expect(404);
    },
  );

  it('documents only the canonical payments path', () => {
    const config = new DocumentBuilder().addBearerAuth(undefined, 'odyssey_api_key').build();
    const document = SwaggerModule.createDocument(app, config);
    expect(Object.keys(document.paths)).toEqual(['/api/v1/payments']);
    expect(document.paths['/api/v1/payments'].get.security).toContainEqual({ odyssey_api_key: [] });
  });
});
