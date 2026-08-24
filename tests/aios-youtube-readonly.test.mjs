import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const providerPath = new URL(
  '../libraries/nestjs-libraries/src/integrations/social/youtube.provider.ts',
  import.meta.url,
);

test('AIOS YouTube provider requests analytics read-only scopes and returns views', async () => {
  const source = await readFile(providerPath, 'utf8');

  assert.match(source, /youtube\.readonly/);
  assert.match(source, /yt-analytics\.readonly/);
  assert.doesNotMatch(source, /youtube\.upload/);
  assert.doesNotMatch(source, /youtube\.force-ssl/);
  assert.doesNotMatch(source, /youtubepartner/);
  assert.match(source, /label: 'Views'/);
  assert.match(source, /total: p\.views/);
});
