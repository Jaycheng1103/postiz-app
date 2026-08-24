import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const controllerPath = new URL(
  '../apps/backend/src/api/routes/no.auth.integrations.controller.ts',
  import.meta.url
);
const servicePath = new URL(
  '../apps/backend/src/aios/aios-gateway.service.ts',
  import.meta.url
);

test('AIOS OAuth completion uses a signed callback after channel selection', async () => {
  const [controller, service] = await Promise.all([
    readFile(controllerPath, 'utf8'),
    readFile(servicePath, 'utf8'),
  ]);

  assert.match(
    controller,
    /notifyOauthCompletion\(\s*body\.state,\s*createUpdate\.id\s*\)/
  );
  assert.match(controller, /notifyOauthCompletion\(body\.state, id\)/);
  assert.match(service, /x-aios-signature/);
  assert.match(service, /createHmac\('sha256'/);
  assert.match(service, /AIOS_CALLBACK_HMAC_SECRET/);
  assert.doesNotMatch(service, /apiKey:\s*org\.apiKey/);
});
