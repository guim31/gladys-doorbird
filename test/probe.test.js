// -----------------------------------------------------------------------------
// scripts/probe.mjs against the fake DoorBird served on 127.0.0.1: it reads,
// listens, writes nothing, and prints no secret; without credentials it only
// checks that a DoorBird refuses an anonymous request.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { FakeDoorBird } from './helpers/fakeDoorBird.js';

const USER = { username: 'abcdef0001', password: 'Front-Secret-1' };

function run(args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['scripts/probe.mjs', ...args], {
      cwd: new URL('..', import.meta.url),
      env: { ...process.env, ...env, LOG_LEVEL: 'silent' },
    });
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    child.stderr.on('data', (chunk) => {
      output += chunk;
    });
    child.on('close', (code) => resolve({ code, output }));
  });
}

test('the probe reads a DoorBird and its events, writes nothing, prints no secret', async (t) => {
  const fake = new FakeDoorBird(USER);
  const server = await fake.serve();
  t.after(() => server.close());
  const ringing = setInterval(() => fake.ring(), 300);
  t.after(() => clearInterval(ringing));
  const { code, output } = await run([server.origin, USER.username, '1'], {
    DOORBIRD_PASSWORD: USER.password,
  });
  assert.equal(code, 0, output);
  assert.match(output, /Model\s+DoorBird D2101V/);
  assert.match(output, /Relays\s+1, 2, abcdef@1, abcdef@2/);
  assert.match(output, /MAC\s+…B1C2/);
  assert.match(output, /Image\s+\d+ KB, 64×36/);
  assert.match(output, /doorbell:H/);
  for (const secret of [USER.password, '1CCAE3A0B1C2']) {
    assert.ok(!output.includes(secret), secret);
  }
  assert.equal(fake.lights, 0);
  assert.deepEqual(fake.doorsOpened, []);
  assert.ok(
    fake.requests.every((request) => !/light-on|open-door|favorites|schedule/.test(request.path)),
  );
});

test('without credentials: one anonymous request, expecting the 401 of a DoorBird', async (t) => {
  const fake = new FakeDoorBird(USER);
  const server = await fake.serve();
  t.after(() => server.close());
  const { code, output } = await run([server.origin]);
  assert.equal(code, 0, output);
  assert.match(output, /HTTP 401/);
  assert.match(output, /A DoorBird LAN API answers here/);
  assert.equal(fake.requests.length, 1);
  assert.equal(fake.requests[0].authorized, false);
  assert.equal(fake.refusals, 0, 'no password tried');
});

test('the probe stops at a refused password, and says how to use it', async () => {
  const fake = new FakeDoorBird(USER);
  const server = await fake.serve();
  const refused = await run([server.origin, USER.username], { DOORBIRD_PASSWORD: 'wrong' });
  await server.close();
  assert.equal(refused.code, 1);
  assert.match(refused.output, /password refused/);
  assert.equal(fake.refusals, 1);
  const usage = await run([], {});
  assert.equal(usage.code, 2);
  const noPassword = await run(['192.0.2.10', 'abcdef0001'], { DOORBIRD_PASSWORD: '' });
  assert.equal(noPassword.code, 2);
});
