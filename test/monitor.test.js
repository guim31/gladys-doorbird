// -----------------------------------------------------------------------------
// The event stream: lines read whatever the multipart framing and the TCP
// chunks, reconnection after a drop, a recycled or quiet stream reopened as a
// routine, a refused password that stops it.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DoorBirdClient, ERROR_KINDS } from '../src/doorbird/client.js';
import { LineSplitter, MonitorStream, parseSignal } from '../src/doorbird/monitor.js';
import { FakeDoorBird } from './helpers/fakeDoorBird.js';
import { settle } from './helpers/world.js';

const USER = { username: 'abcdef0001', password: 'Front-Secret-1' };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('the lines of the stream, and nothing else', () => {
  assert.deepEqual(parseSignal('doorbell:H'), { input: 'doorbell', high: true });
  assert.deepEqual(parseSignal(' motionsensor:L\r'), { input: 'motionsensor', high: false });
  assert.deepEqual(parseSignal('DOORBELL : h'), { input: 'doorbell', high: true });
  for (const other of [
    '--ioboundary',
    'Content-Type: text/plain',
    '',
    'dooropen:H',
    'doorbell:X',
  ]) {
    assert.equal(parseSignal(other), null, other);
  }
});

test('a line split across two chunks, CRLF or LF endings', () => {
  const lines = [];
  const splitter = new LineSplitter((line) => lines.push(line));
  splitter.push(Buffer.from('--ioboundary\r\nContent-Type: text/plain\r\n\r\ndoor'));
  splitter.push(
    Buffer.from('bell:H\r\n\r\n--ioboundary\nContent-Type: text/plain\n\nmotionsensor:L\n'),
  );
  assert.deepEqual(lines.map(parseSignal).filter(Boolean), [
    { input: 'doorbell', high: true },
    { input: 'motionsensor', high: false },
  ]);
});

function stream(t, station, options = {}) {
  const client = new DoorBirdClient({
    origin: 'http://192.0.2.10',
    ...USER,
    ...(options.client ?? {}),
    request: station.request,
  });
  const record = { signals: [], opens: 0, closes: [] };
  const monitor = new MonitorStream({
    client,
    onSignal: (signal) => record.signals.push(signal),
    onOpen: () => {
      record.opens += 1;
    },
    onClose: (err) => record.closes.push(err),
    timings: { quickRetryMs: 10, failureBaseMs: 10, failureMaxMs: 20, ...options.timings },
  });
  t.after(() => monitor.stop());
  monitor.start();
  return { monitor, record, client };
}

test('signals are handed over, and a dropped stream reopens', async (t) => {
  const station = new FakeDoorBird(USER);
  const { monitor, record } = stream(t, station);
  await settle();
  assert.equal(monitor.open, true);
  station.ring();
  await settle();
  assert.deepEqual(
    record.signals.filter((signal) => signal.input === 'doorbell').map((s) => s.high),
    [false, true, false],
  );
  station.dropStreams();
  await sleep(40);
  await settle();
  assert.equal(record.opens, 2);
  assert.equal(record.closes.length, 1);
  assert.equal(record.closes[0].kind, ERROR_KINDS.UNREACHABLE);
});

test('a recycled stream reopens at once, as a routine', async (t) => {
  const station = new FakeDoorBird(USER);
  const { record } = stream(t, station, { timings: { recycleMs: 15 } });
  await sleep(60);
  await settle();
  assert.ok(record.opens >= 2);
  assert.ok(record.closes.every((err) => err.routine));
});

test('a station down: the stream retries with a growing wait, never routine', async (t) => {
  const station = new FakeDoorBird(USER);
  station.online = false;
  const { monitor, record } = stream(t, station);
  await sleep(80);
  assert.ok(record.closes.length >= 2);
  assert.ok(record.closes.every((err) => !err.routine));
  assert.ok(monitor.failures >= 2);
  station.online = true;
  await sleep(40);
  await settle();
  assert.equal(monitor.open, true);
});

test('a refused password stops the stream until restarted', async (t) => {
  const station = new FakeDoorBird(USER);
  const { monitor, record, client } = stream(t, station, { client: { password: 'wrong' } });
  await sleep(40);
  assert.equal(record.closes.length, 1);
  assert.equal(record.closes[0].kind, ERROR_KINDS.AUTH);
  assert.equal(monitor.running, false);
  assert.equal(station.refusals, 1);
  assert.equal(client.blocked, true);
});

test('a stream refused for lack of permission is said so', async (t) => {
  const station = new FakeDoorBird(USER);
  station.streamStatus = 204;
  const { record } = stream(t, station);
  await sleep(30);
  assert.equal(record.closes[0].kind, ERROR_KINDS.FORBIDDEN);
});
