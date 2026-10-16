// -----------------------------------------------------------------------------
// The hub against two fake DoorBirds: devices, rings and motions from the event
// stream, their images and scene events, the infrared light, the door relays
// (disabled by default, never a feature, never retried), the configuration
// actions, the connection status, the identity kept in /data.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TRIGGERS } from '../src/hub.js';
import {
  BASE_CONFIG,
  MACS,
  SECRETS,
  createAll,
  createStations,
  createWorld,
  ids,
  settle,
} from './helpers/world.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function world(t, options) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  return w;
}

test('one device per DoorBird, keyed by its MAC address, never polled by Gladys', async (t) => {
  const w = await world(t);
  const devices = w.fake.discoveredDevices;
  assert.deepEqual(
    devices.map((device) => [device.name, device.external_id, device.model]),
    [
      ['DoorBird D2101V', ids(w.gladys, 'front').device, 'DoorBird D2101V'],
      ['DoorBird D101', ids(w.gladys, 'gate').device, 'DoorBird D101'],
    ],
  );
  for (const device of devices) {
    assert.equal(device.should_poll, false);
    assert.equal(device.poll_frequency, undefined);
    assert.deepEqual(
      device.features.map((feature) => feature.external_id.split(':').at(-1)),
      ['image', 'online', 'ring', 'motion', 'ir_light'],
    );
  }
  assert.deepEqual(w.fake.connectionStatus, { connected: true });
});

test('no door relay is ever a feature: nothing a switch or a voice could open', async (t) => {
  const w = await world(t, { config: { ...BASE_CONFIG, allow_door_open: true } });
  for (const device of w.fake.discoveredDevices) {
    for (const feature of device.features) {
      const key = feature.external_id.split(':').at(-1);
      assert.ok(!/door|relay|lock|open/i.test(key), feature.external_id);
      assert.notEqual(feature.category, 'lock');
      assert.notEqual(feature.category, 'switch');
    }
  }
});

test('the feature names follow the language of the configuration', async (t) => {
  const w = await world(t, { config: { ...BASE_CONFIG, language: 'fr' } });
  assert.deepEqual(
    w.fake.discoveredDevices[0].features.map((feature) => feature.name),
    ['Image', 'En ligne', 'Sonnette', 'Mouvement', 'Éclairage infrarouge'],
  );
});

test('two DoorBirds of the same model are told apart by the end of their MAC', async (t) => {
  const stations = createStations();
  stations.gate.info.BHA.VERSION[0]['DEVICE-TYPE'] = 'DoorBird D2101V';
  const w = await world(t, { stations });
  assert.deepEqual(
    w.fake.discoveredDevices.map((device) => device.name),
    ['DoorBird D2101V B1C2', 'DoorBird D2101V E5F6'],
  );
});

test('states and images go only to the devices added in Gladys, all of them once added', async (t) => {
  const w = await world(t);
  assert.equal(w.fake.states.length, 0);
  assert.equal(w.fake.cameraImages.length, 0);
  await createAll(w);
  const front = ids(w.gladys, 'front');
  assert.equal(w.fake.lastState(front.feature('online')), 1);
  assert.equal(w.fake.lastState(front.feature('ring')), 0);
  assert.equal(w.fake.lastState(front.feature('motion')), 0);
  assert.equal(w.fake.lastState(front.feature('ir_light')), 0);
  assert.equal(w.fake.cameraImages.length, 2);
  assert.match(w.fake.cameraImages[0].image, /^image\/jpg;base64,\/9j\//);
  assert.deepEqual(
    w.fake.transports.map((entry) => entry.transport),
    ['local', 'local'],
  );
});

test('a ring: a 1 → 0 pulse, a fresh image, then the scene event, then the widget', async (t) => {
  const w = await world(t);
  await createAll(w);
  const front = ids(w.gladys, 'front');
  const images = w.fake.cameraImages.length;
  w.clock.advance(60_000);
  await w.ring('front');
  assert.equal(w.fake.lastState(front.feature('ring')), 1);
  assert.deepEqual(w.fake.sceneEvents, [
    {
      key: TRIGGERS.DOORBELL,
      data: { doorbird: front.device, doorbird_name: 'DoorBird D2101V' },
    },
  ]);
  assert.equal(w.fake.cameraImages.length, images + 1, 'the image came before the event');
  assert.ok(w.fake.widgetRefreshes.length > 0);
  await sleep(80);
  await settle();
  assert.equal(w.fake.lastState(front.feature('ring')), 0);
});

test('the repeated state of the stream is never a new ring', async (t) => {
  const w = await world(t);
  await createAll(w);
  w.stations.front.set('doorbell', true);
  await settle();
  for (let i = 0; i < 5; i += 1) {
    w.stations.front.heartbeat();
    await settle();
  }
  assert.equal(w.fake.sceneEvents.length, 1);
});

test('a state seen for the first time is not an event (it may be minutes old)', async (t) => {
  const stations = createStations();
  stations.front.states.doorbell = true;
  stations.front.states.motionsensor = true;
  const w = await world(t, { stations });
  await createAll(w);
  assert.deepEqual(w.fake.sceneEvents, []);
  // The motion is real, though: shown as long as the station reports it.
  assert.equal(w.fake.lastState(ids(w.gladys, 'front').feature('motion')), 1);
});

test('two rings in the spacing window are one scene event', async (t) => {
  const w = await world(t);
  await createAll(w);
  await w.ring('front');
  w.clock.advance(5_000);
  await w.ring('front');
  assert.equal(w.fake.sceneEvents.length, 1);
  w.clock.advance(20_000);
  await w.ring('front');
  assert.equal(w.fake.sceneEvents.length, 2);
});

test('motion: 1 while the station reports it, the scene event at its start', async (t) => {
  const w = await world(t);
  await createAll(w);
  const gate = ids(w.gladys, 'gate');
  await w.motion('gate');
  assert.equal(w.fake.lastState(gate.feature('motion')), 1);
  assert.deepEqual(w.fake.sceneEvents, [
    { key: TRIGGERS.MOTION, data: { doorbird: gate.device, doorbird_name: 'DoorBird D101' } },
  ]);
  w.stations.gate.heartbeat();
  await settle();
  assert.equal(w.fake.sceneEvents.length, 1);
  await w.motion('gate', false);
  assert.equal(w.fake.lastState(gate.feature('motion')), 0);
});

test('a stream that drops mid-motion leaves no motion stuck at 1', async (t) => {
  const w = await world(t);
  await createAll(w);
  await w.motion('front');
  const motion = ids(w.gladys, 'front').feature('motion');
  assert.equal(w.fake.lastState(motion), 1);
  w.stations.front.states.motionsensor = false;
  w.stations.front.dropStreams();
  await settle();
  assert.equal(w.fake.lastState(motion), 0);
});

test('a ring during an outage of the stream fires once it reopens', async (t) => {
  const w = await world(t);
  await createAll(w);
  w.stations.front.dropStreams();
  w.stations.front.states.doorbell = true; // pressed while the stream was down
  await sleep(60);
  await settle();
  assert.equal(w.fake.sceneEvents.length, 1);
});

test('the infrared light: on by command, off by itself, no "off" command', async (t) => {
  const w = await world(t, { timings: { irLightMs: 60 } });
  await createAll(w);
  const [device] = w.fake.discoveredDevices;
  const light = device.features.find((feature) => feature.external_id.endsWith(':ir_light'));
  const ack = await w.fake.setValue(device, light, 1);
  assert.equal(ack.success, true, ack.error);
  assert.equal(w.stations.front.lights, 1);
  assert.equal(w.fake.lastState(light.external_id), 1);
  const off = await w.fake.setValue(device, light, 0);
  assert.equal(off.success, false);
  assert.match(off.error, /goes off by itself/);
  assert.equal(w.stations.front.lights, 1);
  await sleep(100);
  await settle();
  assert.equal(w.fake.lastState(light.external_id), 0);
});

test('the infrared light refused for lack of permission says what to do', async (t) => {
  const w = await world(t);
  await createAll(w);
  w.stations.front.commandStatus = 204;
  const [device] = w.fake.discoveredDevices;
  const light = device.features.find((feature) => feature.external_id.endsWith(':ir_light'));
  const ack = await w.fake.setValue(device, light, 1);
  assert.equal(ack.success, false);
  assert.match(ack.error, /lacks the permission/);
  assert.equal(w.fake.lastState(light.external_id), 0);
});

test('a command on a read-only feature is refused', async (t) => {
  const w = await world(t);
  await createAll(w);
  const [device] = w.fake.discoveredDevices;
  const ring = device.features.find((feature) => feature.external_id.endsWith(':ring'));
  const ack = await w.fake.setValue(device, ring, 1);
  assert.equal(ack.success, false);
});

test('opening the door is disabled by default', async (t) => {
  const w = await world(t);
  await createAll(w);
  const ack = await w.fake.sceneAction('open_door', {
    doorbird: ids(w.gladys, 'front').device,
    relay: '1',
  });
  assert.equal(ack.success, false);
  assert.match(ack.error, /disabled/);
  assert.deepEqual(w.stations.front.doorsOpened, []);
});

test('once allowed: only a relay the DoorBird lists, sent once, never retried', async (t) => {
  const w = await world(t, { config: { ...BASE_CONFIG, allow_door_open: true } });
  await createAll(w);
  const front = ids(w.gladys, 'front').device;
  const gate = ids(w.gladys, 'gate').device;
  assert.equal(
    (await w.fake.sceneAction('open_door', { doorbird: front, relay: '1' })).success,
    true,
  );
  assert.equal(
    (await w.fake.sceneAction('open_door', { doorbird: front, relay: 'abcdef@2' })).success,
    true,
  );
  assert.deepEqual(w.stations.front.doorsOpened, ['1', 'abcdef@2']);
  // The gate (a D101) has no paired controller.
  const unknown = await w.fake.sceneAction('open_door', { doorbird: gate, relay: 'abcdef@1' });
  assert.equal(unknown.success, false);
  assert.match(unknown.error, /no such relay/);
  // A failure is reported, and the relay is not tried again.
  w.stations.gate.commandStatus = 500;
  const failed = await w.fake.sceneAction('open_door', { doorbird: gate, relay: '2' });
  assert.equal(failed.success, false);
  const tries = w.stations.gate.requests.filter((r) => r.path.startsWith('/bha-api/open-door'));
  assert.equal(tries.length, 1);
  // Missing permission: what to do.
  w.stations.gate.commandStatus = 204;
  const forbidden = await w.fake.sceneAction('open_door', { doorbird: gate, relay: '1' });
  assert.match(forbidden.error, /lacks the permission/);
});

test('an old firmware without a relay list accepts the relays 1 to 9 only', async (t) => {
  const stations = createStations();
  stations.front.info = JSON.parse(
    readFileSync(new URL('./fixtures/doorbird/info-old-firmware.json', import.meta.url), 'utf8'),
  );
  stations.front.info.BHA.VERSION[0].RELAYS = undefined;
  const w = await world(t, { stations, config: { ...BASE_CONFIG, allow_door_open: true } });
  const device = w.gladys.externalIds('doorbird', '1CCAE3112233').device;
  assert.equal(w.fake.discoveredDevices[0].name, 'DoorBird');
  const ok = await w.fake.sceneAction('open_door', { doorbird: device, relay: '1' });
  assert.equal(ok.success, true, ok.error);
  const refused = await w.fake.sceneAction('open_door', { doorbird: device, relay: 'abc@1' });
  assert.equal(refused.success, false);
});

test('refresh_image: a fresh image sent to Gladys; Gladys asking for one gets it', async (t) => {
  const w = await world(t);
  await createAll(w);
  const front = ids(w.gladys, 'front').device;
  const before = w.fake.cameraImages.length;
  w.clock.advance(60_000);
  const ack = await w.fake.sceneAction('refresh_image', { doorbird: front });
  assert.equal(ack.success, true, ack.error);
  assert.equal(w.fake.cameraImages.length, before + 1);
  const device = w.fake.discoveredDevices[0];
  const image = await w.fake.getImage(device);
  assert.equal(image.success, true);
  assert.match(image.data.image, /^image\/jpg;base64,/);
  w.stations.front.imageStatus = 204;
  w.clock.advance(60_000);
  const refused = await w.fake.sceneAction('refresh_image', { doorbird: front });
  assert.equal(refused.success, false);
  assert.match(refused.error, /lacks the permission/);
});

test('scene actions on an unknown or missing DoorBird say so', async (t) => {
  const w = await world(t);
  const missing = await w.fake.sceneAction('refresh_image', {});
  assert.match(missing.error, /Choose a DoorBird/);
  const unknown = await w.fake.sceneAction('refresh_image', { doorbird: 'ext:x:doorbird:NOPE' });
  assert.match(unknown.error, /not \(or no longer\)/);
});

test('a refused password: stopped at once, said in the status, resumed by the test', async (t) => {
  const w = await world(t, { config: { ...BASE_CONFIG, password_2: 'wrong-gate-secret' } });
  assert.equal(w.stations.gate.refusals, 1);
  await w.hub.refresh();
  await w.hub.refresh();
  await sleep(40);
  assert.equal(w.stations.gate.refusals, 1, 'never asked again on its own');
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.match(w.fake.connectionStatus.message.en, /Password refused/);
  // The user fixes the password on the DoorBird side, then tests.
  w.stations.gate.password = 'wrong-gate-secret';
  const ack = await w.fake.action('test_connection', {});
  assert.equal(ack.success, true);
  assert.match(ack.data.message.en, /192\.0\.2\.11: DoorBird D101, firmware 000109, relays 1, 2/);
  await sleep(20);
  await settle();
  assert.deepEqual(w.fake.connectionStatus, { connected: true });
  assert.equal(w.hub.stations.get('http://192.0.2.11').stream.open, true);
});

test('test_connection reports each DoorBird, its relays and its image permission', async (t) => {
  const w = await world(t);
  w.stations.gate.imageStatus = 204;
  const ack = await w.fake.action('test_connection', {});
  assert.equal(ack.success, true);
  const { en, fr, de, es } = ack.data.message;
  assert.match(
    en,
    /192\.0\.2\.10: DoorBird D2101V, firmware 000125, relays 1, 2, abcdef@1, abcdef@2\. Image: OK\./,
  );
  assert.match(en, /Image: refused, give "Watch always" to this user\./);
  assert.match(fr, /relais 1, 2/);
  assert.match(de, /Relais 1, 2/);
  assert.match(es, /relés 1, 2/);
  for (const text of [en, fr, de, es]) {
    for (const secret of SECRETS) {
      assert.ok(!text.includes(secret));
    }
  }
});

test('stream_url: the RTSP address with a PASSWORD placeholder', async (t) => {
  const w = await world(t);
  const ack = await w.fake.action('stream_url', { doorbird: ids(w.gladys, 'front').device });
  assert.equal(ack.success, true);
  assert.match(
    ack.data.message.en,
    /rtsp:\/\/abcdef0001:PASSWORD@192\.0\.2\.10:554\/mpeg\/media\.amp$/,
  );
  for (const secret of SECRETS) {
    assert.ok(!JSON.stringify(ack).includes(secret));
  }
  const none = await w.fake.action('stream_url', {});
  assert.equal(none.success, false);
});

test('connection status: nothing configured, an incomplete slot, a bad address', async (t) => {
  const empty = await world(t, { config: {} });
  assert.equal(empty.fake.connectionStatus.connected, false);
  assert.match(empty.fake.connectionStatus.message.en, /Enter the address/);
  const incomplete = await world(t, { config: { host: '192.0.2.10', username: 'abcdef0001' } });
  assert.match(incomplete.fake.connectionStatus.message.fr, /nom d'utilisateur et le mot de passe/);
  const bad = await world(t, { config: { host: 'http://user:pw@192.0.2.10' } });
  assert.match(bad.fake.connectionStatus.message.en, /Address not understood/);
});

test('a DoorBird that stops answering: offline, unreachable, back again', async (t) => {
  const w = await world(t);
  await createAll(w);
  const gate = ids(w.gladys, 'gate');
  w.stations.gate.online = false;
  w.stations.gate.dropStreams();
  await settle();
  await w.hub.refresh();
  assert.equal(w.fake.lastState(gate.feature('online')), 0);
  assert.equal(w.fake.transports.at(-1).transport, 'unreachable');
  assert.equal(w.fake.connectionStatus.connected, true);
  assert.match(w.fake.connectionStatus.message.en, /does not answer/);
  w.stations.gate.online = true;
  await w.hub.refresh();
  assert.equal(w.fake.lastState(gate.feature('online')), 1);
  await sleep(60); // the stream retries
  await settle();
  assert.deepEqual(w.fake.connectionStatus, { connected: true });
});

test('the identity is kept in /data: a DoorBird off at start keeps its device', async (t) => {
  const first = await createWorld();
  await first.app.stop();
  const saved = JSON.parse(readFileSync(join(first.dataDir, 'doorbird-state.json'), 'utf8'));
  assert.equal(saved.stations['http://192.0.2.10'].mac, MACS.front);
  assert.ok(!JSON.stringify(saved).includes(SECRETS[0]), 'no password in /data');

  const stations = createStations();
  stations.gate.online = false;
  const w = await world(t, { stations, dataDir: first.dataDir });
  assert.deepEqual(
    w.fake.discoveredDevices.map((device) => device.external_id),
    [ids(w.gladys, 'front').device, ids(w.gladys, 'gate').device],
  );
});

test('a new configuration replaces the stations and their streams', async (t) => {
  const w = await world(t);
  await w.fake.configUpdated({ ...BASE_CONFIG, host_2: '' });
  await settle();
  assert.equal(w.fake.discoveredDevices.length, 1);
  assert.equal(w.stations.gate.streams.size, 0);
  // The language alone: the same streams, renamed features.
  const streams = w.stations.front.streamAttempts;
  await w.fake.configUpdated({ ...BASE_CONFIG, host_2: '', language: 'de' });
  assert.equal(w.stations.front.streamAttempts, streams);
  assert.equal(w.fake.discoveredDevices[0].features[2].name, 'Türklingel');
});

test('Gladys restarted: everything is sent again', async (t) => {
  const w = await world(t);
  await createAll(w);
  const before = w.fake.states.length;
  await w.gladys.disconnect();
  await w.gladys.connect();
  await settle();
  assert.ok(w.fake.states.length > before);
});

test('a scan request reads the DoorBirds again', async (t) => {
  const w = await world(t);
  const reads = w.stations.front.requests.filter((r) => r.path === '/bha-api/info.cgi').length;
  await w.fake.scanRequest();
  assert.equal(
    w.stations.front.requests.filter((r) => r.path === '/bha-api/info.cgi').length,
    reads + 1,
  );
});
