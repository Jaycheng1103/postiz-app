import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function source(path) {
  return readFile(new URL(path, import.meta.url), 'utf8');
}

test('Postiz exposes the tenant-bound AIOS gateway contract', async () => {
  const [schema, appModule, controller] = await Promise.all([
    source('../libraries/nestjs-libraries/src/database/prisma/schema.prisma'),
    source('../apps/backend/src/app.module.ts'),
    source('../apps/backend/src/aios/aios-gateway.controller.ts'),
  ]);

  assert.match(schema, /aiosAccountId\s+String\?\s+@unique/);
  assert.match(appModule, /AiosGatewayModule/);
  assert.match(controller, /@Controller\('\/aios\/v1'/);
  assert.match(controller, /@Post\('\/organizations'/);
  assert.match(controller, /@Post\('\/organizations\/:organizationId\/connect-intents'/);
  assert.match(controller, /@Get\('\/organizations\/:organizationId\/integrations'/);
  assert.match(
    controller,
    /@Get\([\s\S]*?'\/organizations\/:organizationId\/integrations\/:integrationId\/analytics'[\s\S]*?\)/,
  );
  assert.match(controller, /@Delete\('\/organizations\/:organizationId\/integrations\/:integrationId'/);
  assert.match(controller, /@Delete\('\/organizations\/:organizationId'/);
});
