// -----------------------------------------------------------------------------
// The configuration as typed: addresses, the two slots and their own
// credentials, the defaults of the manifest, never a password kept in an
// address.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, normalizeConfig, parseHost } from '../src/config.js';

test('addresses as people type them', () => {
  assert.deepEqual(parseHost('192.0.2.10'), { origin: 'http://192.0.2.10', label: '192.0.2.10' });
  assert.deepEqual(parseHost(' 192.0.2.10:8080 '), {
    origin: 'http://192.0.2.10:8080',
    label: '192.0.2.10:8080',
  });
  assert.deepEqual(parseHost('https://door.lan'), {
    origin: 'https://door.lan',
    label: 'door.lan',
  });
  assert.deepEqual(parseHost('http://192.0.2.10/bha-api/'), {
    origin: 'http://192.0.2.10',
    label: '192.0.2.10',
  });
  assert.equal(parseHost('[2001:db8::10]').origin, 'http://[2001:db8::10]');
  for (const bad of [
    '',
    'user:pw@192.0.2.10',
    'ftp://192.0.2.10',
    'http://x/y',
    'a b',
    'http://h?q',
  ]) {
    assert.equal(parseHost(bad), null, bad);
  }
});

test('two DoorBirds, each with its own user', () => {
  const config = normalizeConfig({
    host: '192.0.2.10',
    username: 'abcdef0001',
    password: ' pass with spaces ',
    host_2: '192.0.2.11',
    username_2: 'ghijkl0001',
    password_2: 'other',
    snapshot_interval: '15',
    allow_door_open: 'true',
    language: 'de',
  });
  assert.deepEqual(
    config.stations.map((s) => [s.origin, s.slot, s.username, s.password]),
    [
      ['http://192.0.2.10', 1, 'abcdef0001', ' pass with spaces '],
      ['http://192.0.2.11', 2, 'ghijkl0001', 'other'],
    ],
  );
  assert.equal(config.snapshotIntervalMs, 15 * 60_000);
  assert.equal(config.allowDoorOpen, true);
  assert.equal(config.language, 'de');
});

test('defaults: nothing configured, no door opening, French names, an image every 5 min', () => {
  const config = normalizeConfig(DEFAULT_CONFIG);
  assert.deepEqual(config.stations, []);
  assert.equal(config.allowDoorOpen, false);
  assert.equal(config.language, 'fr');
  assert.equal(config.snapshotIntervalMs, 5 * 60_000);
  assert.deepEqual(normalizeConfig(undefined).stations, []);
  assert.equal(normalizeConfig({ language: 'it', snapshot_interval: '7' }).language, 'fr');
  assert.equal(normalizeConfig({ snapshot_interval: '7' }).snapshotIntervalMs, 5 * 60_000);
});

test('an address without its user or password is never contacted', () => {
  const config = normalizeConfig({ host: '192.0.2.10', username: 'abcdef0001' });
  assert.deepEqual(config.stations, []);
  assert.deepEqual(config.incomplete, ['192.0.2.10']);
});

test('an address holding credentials is refused, and never repeated', () => {
  const config = normalizeConfig({
    host: 'http://abcdef0001:secret@192.0.2.10',
    username: 'abcdef0001',
    password: 'secret',
  });
  assert.deepEqual(config.stations, []);
  assert.deepEqual(config.invalidHosts, ['…@…']);
});

test('the same DoorBird typed twice is one station', () => {
  const config = normalizeConfig({
    host: '192.0.2.10',
    username: 'a',
    password: 'b',
    host_2: 'http://192.0.2.10',
    username_2: 'c',
    password_2: 'd',
  });
  assert.equal(config.stations.length, 1);
  assert.equal(config.stations[0].username, 'a');
});
