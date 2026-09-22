import { ValidationPipe, type INestApplication } from '@nestjs/common';

/** App-wide configuration shared by main.ts and the e2e tests. */
export function setupApp(app: INestApplication): void {
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // strip properties without validation decorators
      forbidNonWhitelisted: true, // …and reject requests that send them
      transform: true, // run @Transform (email normalization etc.)
    }),
  );
  app.enableShutdownHooks();
}
