// -----------------------------------------------------------------------------
// What the integration writes at the default level (info): the lifecycle
// only. A normal cycle — reads, rings, motions, images, scene events, the
// heartbeat of the stream — writes nothing; a failure that repeats is logged
// once, and its end once. Never a password of the configuration.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BASE_CONFIG, SECRETS, createAll, createWorld, ids, settle } from './helpers/world.js';

/** Capture the lines of the SDK logger at a level. */
function captureLogs(t, level = 'info') {
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = level;
  t.after(() => {
    process.env.LOG_LEVEL = previous;
  });
  const lines = [];
  const record =
    (stream) =>
    (...args) =>
      lines.push({
        stream,
        text: args.map((arg) => (arg instanceof Error ? arg.stack : String(arg))).join(' '),
      });
  t.mock.method(console, 'log', record('out'));
  t.mock.method(console, 'error', record('err'));
  t.mock.method(console, 'warn', record('err'));
  return {
    lines,
    clear: () => lines.splice(0),
    texts: () => lines.map((line) => line.text),
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function world(t, options = {}) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  return w;
}

const noSecret = (text) => {
  for (const secret of SECRETS) {
    assert.ok(!text.includes(secret), 'a password in the logs');
  }
};

test('a normal cycle writes nothing at info', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  assert.ok(
    logs.texts().some((text) => text.includes('Connected to DoorBird D2101V at 192.0.2.10')),
    'the start is logged',
  );
  await createAll(w);
  logs.clear();

  for (let i = 0; i < 3; i += 1) {
    await w.ring('front');
    await w.motion('gate');
    w.stations.front.heartbeat();
    w.stations.gate.heartbeat();
    await w.motion('gate', false);
    w.clock.advance(5 * 60_000);
    await w.hub.refresh();
    await w.hub.snapshotAll();
    await w.fake.widgetGet('doorbird', { settings: {}, language: 'en' });
  }
  await sleep(80); // the ring pulses end
  await settle();
  assert.deepEqual(logs.texts(), []);
  assert.equal(w.fake.sceneEvents.length, 6);
});

test('the hourly recycling of the event streams writes nothing at info', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t, { streamTimings: { recycleMs: 20 } });
  await createAll(w);
  logs.clear();
  await sleep(120);
  await settle();
  assert.ok(w.stations.front.streamAttempts >= 3, 'recycled several times');
  assert.deepEqual(logs.texts(), []);
  assert.deepEqual(w.fake.connectionStatus, { connected: true });
});

test('a DoorBird that stays down is logged once, and once when it is back', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  logs.clear();

  w.stations.gate.online = false;
  w.stations.gate.dropStreams();
  for (let i = 0; i < 6; i += 1) {
    w.clock.advance(60_000);
    await w.hub.refresh();
    await sleep(30); // the stream retries
  }
  const lines = logs.texts();
  assert.equal(
    lines.filter((text) => text.includes('Cannot read the DoorBird at 192.0.2.11')).length,
    1,
    lines.join('\n'),
  );
  assert.equal(
    lines.filter((text) => text.includes('Live events of 192.0.2.11')).length,
    1,
    lines.join('\n'),
  );
  assert.equal(
    lines.filter((text) => text.includes('192.0.2.11 is offline')).length,
    1,
    lines.join('\n'),
  );
  assert.equal(lines.length, 3, lines.join('\n'));

  logs.clear();
  w.stations.gate.online = true;
  await w.hub.refresh();
  await sleep(80);
  await settle();
  await w.hub.refresh();
  const back = logs.texts();
  assert.equal(
    back.filter((text) => /answers again after 5 min/.test(text)).length,
    1,
    back.join('\n'),
  );
  assert.equal(back.filter((text) => text.includes('connected again')).length, 1, back.join('\n'));
  assert.equal(back.filter((text) => text.includes('online again')).length, 1, back.join('\n'));
  assert.equal(back.length, 3, back.join('\n'));
});

test('a refused password is logged once, its repeats only at debug; never a password', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t, { config: { ...BASE_CONFIG, password_2: 'wrong-gate-secret-value' } });
  for (let i = 0; i < 5; i += 1) {
    await w.hub.refresh();
    await sleep(30);
  }
  const warnings = logs.lines.filter((line) => line.stream === 'err');
  assert.equal(warnings.length, 1, logs.texts().join('\n'));
  assert.match(
    warnings[0].text,
    /Cannot read the DoorBird at 192\.0\.2\.11: User name or password refused/,
  );
  const all = logs.texts().join('\n');
  noSecret(all);
  assert.ok(!all.includes('wrong-gate-secret-value'));
});

test('a DoorBird that stops sending images is logged once, and once when it is back', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  await createAll(w);
  logs.clear();
  w.stations.front.imageStatus = 204;
  for (let i = 0; i < 4; i += 1) {
    w.clock.advance(10 * 60_000);
    await w.hub.snapshotAll();
  }
  const failing = logs.texts();
  assert.equal(failing.length, 1, failing.join('\n'));
  assert.match(failing[0], /No image from 192\.0\.2\.10: The DoorBird user lacks the permission/);
  logs.clear();
  w.stations.front.imageStatus = 200;
  w.clock.advance(10 * 60_000);
  await w.hub.snapshotAll();
  assert.equal(logs.texts().length, 1, logs.texts().join('\n'));
  assert.match(logs.texts()[0], /Images of 192\.0\.2\.10: back/);
});

test('a user command is one line; the stream address never holds the password', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t, { config: { ...BASE_CONFIG, allow_door_open: true } });
  await createAll(w);
  logs.clear();
  const [device] = w.fake.discoveredDevices;
  const light = device.features.find((f) => f.external_id.endsWith(':ir_light'));
  await w.fake.setValue(device, light, 1);
  assert.equal(logs.texts().length, 1);
  assert.match(logs.texts()[0], /DoorBird D2101V: infrared light on/);
  logs.clear();
  await w.fake.action('stream_url', { doorbird: device.external_id });
  assert.equal(logs.texts().length, 1);
  logs.clear();
  await w.fake.sceneAction('open_door', { doorbird: ids(w.gladys, 'gate').device, relay: '1' });
  assert.equal(logs.texts().length, 1);
  assert.match(logs.texts()[0], /relay 1 of DoorBird D101 energized/);
  noSecret(logs.texts().join('\n'));
});

test('LOG_LEVEL=debug shows the events and the reads; never a password', async (t) => {
  const logs = captureLogs(t, 'debug');
  const w = await world(t);
  await w.ring('front');
  w.stations.gate.online = false;
  await w.hub.refresh();
  await w.hub.refresh();
  const text = logs.texts().join('\n');
  assert.match(text, /\[DEBUG\].*DoorBird D2101V: doorbell active/);
  assert.match(text, /\[DEBUG\].*Cannot read the DoorBird at 192\.0\.2\.11/);
  noSecret(text);
});
