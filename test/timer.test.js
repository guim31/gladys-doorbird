// -----------------------------------------------------------------------------
// The timers of the container. Gladys never polls a device published with
// should_poll: false (and never polls the devices created without should_poll,
// GladysAssistant/Gladys#3198): the stations must be read again by the hub's
// own timer, with no onPoll at all — every 5 minutes while the event streams
// are live, every minute while one is down — and the images refreshed at the
// interval of the configuration.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HUB_TIMINGS } from '../src/hub.js';
import { BASE_CONFIG, createAll, createWorld, ids, settle } from './helpers/world.js';

async function timedWorld(t, options = {}) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 1_760_000_000_000 });
  // The hub reads the mocked clock, which the ticks move.
  const clock = { now: () => Date.now() };
  const w = await createWorld({ timers: true, clock, ...options });
  t.after(() => w.app.stop());
  await createAll(w);
  return w;
}

const infoReads = (w, name = 'front') =>
  w.stations[name].requests.filter((r) => r.path === '/bha-api/info.cgi').length;

async function tick(t, ms) {
  t.mock.timers.tick(ms);
  await settle();
}

test('the internal timer reads the stations again without any onPoll from Gladys', async (t) => {
  const w = await timedWorld(t);
  assert.ok(w.fake.discoveredDevices.every((device) => device.should_poll === false));
  const online = ids(w.gladys, 'gate').feature('online');
  const before = infoReads(w);

  // The gate goes off the network: the next read sees it.
  w.stations.gate.online = false;
  w.stations.gate.dropStreams();
  await settle();
  await tick(t, HUB_TIMINGS.refreshMs);
  assert.equal(w.fake.lastState(online), 0);
  w.stations.gate.online = true;
  await tick(t, HUB_TIMINGS.fallbackRefreshMs);
  assert.equal(w.fake.lastState(online), 1);

  // The test never calls fake.poll(): every read came from the timer.
  assert.ok(infoReads(w) - before >= 2, 'read by the timer');
});

test('while every stream is live, the stations are read every 5 minutes', async (t) => {
  const w = await timedWorld(t);
  const before = infoReads(w);
  await tick(t, HUB_TIMINGS.refreshMs);
  await tick(t, HUB_TIMINGS.refreshMs);
  assert.equal(infoReads(w) - before, 2);
});

test('while an event stream is down, the stations are read every minute', async (t) => {
  const w = await timedWorld(t);
  // The front door refuses its stream again: it stays down.
  w.stations.front.streamStatus = 500;
  w.stations.front.dropStreams();
  await settle();
  const before = infoReads(w);
  await tick(t, HUB_TIMINGS.fallbackRefreshMs);
  await tick(t, HUB_TIMINGS.fallbackRefreshMs);
  assert.equal(infoReads(w) - before, 2);
});

test('images follow the interval of the configuration', async (t) => {
  const w = await timedWorld(t);
  const images = w.fake.cameraImages.length;
  await tick(t, 5 * 60_000);
  assert.equal(w.fake.cameraImages.length - images, 2);
});

test('no periodic image when the configuration says "only on events"', async (t) => {
  const w = await timedWorld(t, { config: { ...BASE_CONFIG, snapshot_interval: '0' } });
  const images = w.fake.cameraImages.length;
  await tick(t, 60 * 60_000);
  assert.equal(w.fake.cameraImages.length, images);
});

test('the infrared light goes back to 0 once it went off by itself', async (t) => {
  const w = await timedWorld(t);
  const [device] = w.fake.discoveredDevices;
  const light = device.features.find((f) => f.external_id.endsWith(':ir_light'));
  await w.fake.setValue(device, light, 1);
  assert.equal(w.fake.lastState(light.external_id), 1);
  await tick(t, HUB_TIMINGS.irLightMs - 1_000);
  assert.equal(w.fake.lastState(light.external_id), 1);
  await tick(t, 1_000);
  assert.equal(w.fake.lastState(light.external_id), 0);
});

test('the timers stop with the integration', async (t) => {
  const w = await timedWorld(t);
  await w.app.stop();
  const requests = w.stations.front.requests.length;
  await tick(t, 60 * 60_000);
  assert.equal(w.stations.front.requests.length, requests);
  assert.equal(w.stations.front.streams.size, 0);
});

test('an unchanged value is sent again every 6 hours (heartbeat, under the 12 h rule)', async (t) => {
  const w = await timedWorld(t, { config: { ...BASE_CONFIG, snapshot_interval: '0' } });
  const feature = ids(w.gladys, 'front').feature('online');
  const sent = () =>
    w.fake.states.filter((state) => state.device_feature_external_id === feature).length;
  const before = sent();
  for (let elapsed = 0; elapsed < HUB_TIMINGS.heartbeatMs - HUB_TIMINGS.refreshMs;) {
    await tick(t, HUB_TIMINGS.refreshMs);
    elapsed += HUB_TIMINGS.refreshMs;
  }
  assert.equal(sent(), before, 'nothing sent while the value is recent');
  await tick(t, 2 * HUB_TIMINGS.refreshMs);
  assert.equal(sent(), before + 1, 'sent again once 6 hours old');
  assert.ok(HUB_TIMINGS.heartbeatMs <= 12 * 60 * 60_000);
});
