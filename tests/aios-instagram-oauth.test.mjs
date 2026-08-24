import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function source(path) {
  return readFile(new URL(path, import.meta.url), 'utf8');
}

test('AIOS gateway exposes Instagram Login with insights-only identity data', async () => {
  const [service, controller, provider] = await Promise.all([
    source('../apps/backend/src/aios/aios-gateway.service.ts'),
    source('../apps/backend/src/aios/aios-gateway.controller.ts'),
    source(
      '../libraries/nestjs-libraries/src/integrations/social/instagram.standalone.provider.ts',
    ),
  ]);

  assert.match(controller, /provider:\s*'youtube'\s*\|\s*'instagram'/);
  assert.match(service, /'instagram-standalone'/);
  assert.match(service, /getSocialIntegration\([\s\S]*?providerIdentifier\(input\.provider\)/);
  assert.match(service, /identifier === 'instagram-standalone'/);
  assert.match(service, /return 'instagram'/);
  assert.match(service, /'instagram-standalone' as const/);
  assert.match(provider, /instagram_business_basic/);
  assert.match(provider, /instagram_business_manage_insights/);
});
