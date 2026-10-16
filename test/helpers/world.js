// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, two fake DoorBirds (a D2101V
// at the front door, a wired D101 at the gate, each with its own user), a
// temporary /data and a manual clock, with the integration wired on top
// through registerHandlers. No periodic timer runs unless `timers: true`
// (with node:test mock timers): the tests read the stations with
// `world.hub.refresh()` and drive their inputs with `world.ring(...)`,
// `world.motion(...)`.
// -----------------------------------------------------------------------------

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { Store } from '../../src/store.js';
import { FakeDoorBird, network } from './fakeDoorBird.js';

// The integration logs its lifecycle; keep the test output readable.
process.env.LOG_LEVEL ??= 'silent';

export const ORIGINS = {
  front: 'http://192.0.2.10',
  gate: 'http://192.0.2.11',
};

export const USERS = {
  front: { username: 'abcdef0001', password: 'Front-Secret-1' },
  gate: { username: 'ghijkl0001', password: 'Gate-Secret-2' },
};

export const MACS = {
  front: '1CCAE3A0B1C2',
  gate: '1CCAE3D4E5F6',
};

export const BASE_CONFIG = {
  host: '192.0.2.10',
  username: USERS.front.username,
  password: USERS.front.password,
  host_2: '192.0.2.11',
  username_2: USERS.gate.username,
  password_2: USERS.gate.password,
  snapshot_interval: '5',
  allow_door_open: false,
  language: 'en',
};

export const SECRETS = [USERS.front.password, USERS.gate.password];

/** A manual clock. */
export function createClock(start = Date.UTC(2026, 9, 15, 18, 0, 0)) {
  const clock = {
    time: start,
    now: () => clock.time,
    advance(ms) {
      clock.time += ms;
    },
  };
  return clock;
}

/** Let the streams, the handlers and the fake network settle. */
export async function settle(rounds = 40) {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

export function createStations() {
  return {
    front: new FakeDoorBird({ ...USERS.front, info: 'info-d2101v.json' }),
    gate: new FakeDoorBird({ ...USERS.gate, info: 'info-d101-wired.json' }),
  };
}

/**
 * @param {object} [options]
 * @param {object} [options.stations] fake stations by name
 * @param {object} [options.config] raw integration config
 * @param {Array} [options.created] devices already created in Gladys
 * @param {boolean} [options.connect]
 * @param {boolean} [options.timers]
 * @param {object} [options.timings] HUB_TIMINGS overrides
 * @param {object} [options.origins] addresses of extra stations, by name
 */
export async function createWorld({
  clock = createClock(),
  stations = createStations(),
  config = BASE_CONFIG,
  created = [],
  connect = true,
  dataDir = mkdtempSync(join(tmpdir(), 'gladys-doorbird-')),
  timings = {},
  streamTimings = {},
  timers = false,
  origins = {},
} = {}) {
  const gladys = createFakeGladys({ config, devices: created });
  const where = { ...ORIGINS, ...origins };
  const request = network(
    Object.fromEntries(Object.entries(stations).map(([name, station]) => [where[name], station])),
  );
  const app = registerHandlers(gladys, {
    store: new Store(dataDir),
    request,
    timers,
    timings: { pulseMs: 50, eventImageWaitMs: 200, ...timings },
    streamTimings: {
      quickRetryMs: 20,
      failureBaseMs: 20,
      failureMaxMs: 40,
      ...streamTimings,
    },
    now: clock.now,
  });
  const world = {
    gladys,
    fake: gladys.fake,
    stations,
    app,
    hub: app.hub,
    clock,
    dataDir,
    /** A ring at a station, then let it be handled. */
    async ring(name) {
      stations[name].ring();
      await settle();
    },
    /** The motion sensor of a station goes active (or idle). */
    async motion(name, high = true) {
      stations[name].set('motionsensor', high);
      await settle();
    },
  };
  if (connect) {
    await gladys.connect();
    await app.ready;
    await settle();
  }
  return world;
}

/** External ids of a station of the fixtures. */
export const ids = (gladys, name) => gladys.externalIds('doorbird', MACS[name]);

/** Add every discovered device in Gladys, as the user would. */
export async function createAll(world) {
  for (const device of world.fake.discoveredDevices) {
    await world.fake.deviceCreated(device);
  }
  await settle();
}

export { FakeDoorBird };
