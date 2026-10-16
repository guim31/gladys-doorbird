// -----------------------------------------------------------------------------
// The client of one DoorBird: the identity read from info.cgi (fixtures), the
// answers the LAN API gives (401, 204, 404, a refused command), the password
// kept out of every URL, and the real node:http transport against the fake
// station served on 127.0.0.1.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DoorBirdClient,
  ERROR_KINDS,
  MONITOR_PATH,
  cleanMac,
  cleanRelay,
  parseInfo,
} from '../src/doorbird/client.js';
import { FakeDoorBird, fixture } from './helpers/fakeDoorBird.js';

const USER = { username: 'abcdef0001', password: 'Front-Secret-1' };

function setup(options = {}) {
  const station = new FakeDoorBird({ ...USER, ...options });
  const client = new DoorBirdClient({
    origin: 'http://192.0.2.10',
    ...USER,
    ...(options.client ?? {}),
    request: station.request,
  });
  return { station, client };
}

test('info.cgi: model, firmware, Wi-Fi MAC and relays of a D2101V', () => {
  assert.deepEqual(parseInfo(fixture('info-d2101v.json')), {
    mac: '1CCAE3A0B1C2',
    model: 'DoorBird D2101V',
    firmware: '000125',
    build: '15870439',
    relays: ['1', '2', 'abcdef@1', 'abcdef@2'],
  });
});

test('info.cgi: the wired MAC comes first, as Home Assistant keys its devices', () => {
  assert.equal(parseInfo(fixture('info-d101-wired.json')).mac, '1CCAE3D4E5F6');
});

test('info.cgi: an old firmware lists neither relays nor device type', () => {
  assert.deepEqual(parseInfo(fixture('info-old-firmware.json')), {
    mac: '1CCAE3112233',
    model: null,
    firmware: '000099',
    build: '14010101',
    relays: [],
  });
});

test('info.cgi: an answer that is not a DoorBird is said so', () => {
  for (const json of [{}, { BHA: { VERSION: [] } }, { BHA: { VERSION: [{ FIRMWARE: '1' }] } }]) {
    assert.throws(
      () => parseInfo(json),
      (err) => err.kind === ERROR_KINDS.NOT_DOORBIRD,
    );
  }
});

test('relays and MAC addresses are cleaned', () => {
  assert.equal(cleanRelay(' 1 '), '1');
  assert.equal(cleanRelay('abcdef@2'), 'abcdef@2');
  for (const bad of ['', '1&r=2', '../x', 'a b', null, '@1']) {
    assert.equal(cleanRelay(bad), null, String(bad));
  }
  assert.equal(cleanMac('1c:ca:e3:a0:b1:c2'), '1CCAE3A0B1C2');
  assert.equal(cleanMac(''), null);
});

test('the password travels in the Authorization header only, never in a URL', async () => {
  const urls = [];
  const station = new FakeDoorBird(USER);
  const client = new DoorBirdClient({
    origin: 'http://192.0.2.10',
    ...USER,
    request: (url, options) => {
      urls.push(url);
      return station.request(url, options);
    },
  });
  await client.info();
  await client.image();
  await client.lightOn();
  assert.ok(urls.length === 3);
  for (const url of urls) {
    assert.ok(!url.includes(USER.password) && !url.includes('@192'), url);
  }
});

test('a refused password blocks the client: no second try until unblocked', async () => {
  const { station, client } = setup({ client: { password: 'wrong' } });
  await assert.rejects(client.info(), (err) => err.kind === ERROR_KINDS.AUTH);
  await assert.rejects(client.info(), (err) => err.kind === ERROR_KINDS.BLOCKED);
  await assert.rejects(client.monitor(), (err) => err.kind === ERROR_KINDS.BLOCKED);
  assert.equal(station.refusals, 1, 'one refused password, never more');
  client.unblock();
  await assert.rejects(client.info(), (err) => err.kind === ERROR_KINDS.AUTH);
  assert.equal(station.refusals, 2);
});

test('204: the DoorBird user lacks the permission', async () => {
  const { station, client } = setup();
  station.imageStatus = 204;
  await assert.rejects(client.image(), (err) => err.kind === ERROR_KINDS.FORBIDDEN);
  station.commandStatus = 204;
  await assert.rejects(client.lightOn(), (err) => err.kind === ERROR_KINDS.FORBIDDEN);
  await assert.rejects(client.openDoor('1'), (err) => err.kind === ERROR_KINDS.FORBIDDEN);
  assert.deepEqual(station.doorsOpened, []);
});

test('404: no DoorBird LAN API at this address', async () => {
  const client = new DoorBirdClient({
    origin: 'http://192.0.2.10',
    ...USER,
    request: async () => ({ status: 404, headers: {}, body: Buffer.from('Not found') }),
  });
  await assert.rejects(client.info(), (err) => err.kind === ERROR_KINDS.NOT_DOORBIRD);
});

test('a command answered RETURNCODE 0 is refused; an empty 200 is accepted', async () => {
  const answers = [
    { status: 200, headers: {}, body: Buffer.from('{"BHA":{"RETURNCODE":"0"}}') },
    { status: 200, headers: {}, body: Buffer.alloc(0) },
  ];
  const client = new DoorBirdClient({
    origin: 'http://192.0.2.10',
    ...USER,
    request: async () => answers.shift(),
  });
  await assert.rejects(client.lightOn(), (err) => err.kind === ERROR_KINDS.REFUSED);
  await client.lightOn();
});

test('open-door.cgi: the relay is sent once, cleaned, and a bad one never leaves', async () => {
  const { station, client } = setup();
  await client.openDoor('abcdef@1');
  assert.deepEqual(station.doorsOpened, ['abcdef@1']);
  await assert.rejects(client.openDoor('1&r=2'), (err) => err.kind === ERROR_KINDS.REFUSED);
  assert.ok(!station.requests.some((request) => request.path.includes('&r=2')));
  station.commandStatus = 500;
  await assert.rejects(client.openDoor('1'));
  // A failure is never retried.
  assert.equal(station.requests.filter((r) => r.path.startsWith('/bha-api/open-door')).length, 2);
});

test('an image that is not a JPEG is refused', async () => {
  const { station, client } = setup();
  station.image = Buffer.from('<html>login</html>');
  await assert.rejects(client.image(), /no JPEG/);
});

test('an unreachable station is said so, without the address of credentials', async () => {
  const { station, client } = setup();
  station.online = false;
  await assert.rejects(client.info(), (err) => {
    assert.equal(err.kind, ERROR_KINDS.UNREACHABLE);
    assert.ok(!err.message.includes(USER.password));
    return true;
  });
});

test('the real HTTP transport: JSON, image and the event stream of the fake station', async (t) => {
  const station = new FakeDoorBird(USER);
  const server = await station.serve();
  t.after(() => server.close());
  const client = new DoorBirdClient({ origin: server.origin, ...USER });
  assert.equal((await client.info()).model, 'DoorBird D2101V');
  assert.ok((await client.image()).length > 100);
  const response = await client.monitor({ timeoutMs: 5_000 });
  assert.equal(response.status, 200);
  assert.match(response.headers['content-type'], /boundary=--ioboundary/);
  let text = '';
  for await (const chunk of response.stream) {
    text += chunk.toString();
    if (text.includes('motionsensor:L')) {
      break;
    }
  }
  response.close();
  assert.match(text, /doorbell:L/);
  assert.equal(station.requests.at(-1).path, MONITOR_PATH);
});
