// -----------------------------------------------------------------------------
// The client of ONE DoorBird door station, over its official LAN API: every
// call is a GET under `/bha-api/`, authenticated with HTTP Basic by a user of
// the DoorBird (the DoorBird App creates them, one per use).
//
//   info.cgi        identity: device type, firmware, MAC addresses, relays
//   image.cgi       a JPEG of the camera
//   light-on.cgi    the infrared light, about 3 minutes, then off by itself
//   open-door.cgi   a relay (door strike, gate): ?r=1, 2, or `<id>@<n>` for
//                   a paired I/O door controller
//   monitor.cgi     the event stream (src/doorbird/monitor.js)
//
// What the library (klikini/doorbirdpy, MIT), Home Assistant, Homebridge and
// ioBroker show of the answers, applied here:
//   - 401: user name or password refused. The client then stops talking to
//     the device (`blocked`) until the configuration changes or the user
//     tests the connection: never a retry loop on a password;
//   - 204: the user lacks the permission ("watch always" for the image and
//     the light, the relay for a door);
//   - 404: no DoorBird LAN API at this address (or a model without it).
// The password never appears in a log, an error or a URL: it travels in the
// Authorization header only (doorbirdpy puts it in the URL; not here).
// -----------------------------------------------------------------------------

import { request as httpRequest } from './http.js';

export const ERROR_KINDS = Object.freeze({
  UNREACHABLE: 'unreachable',
  AUTH: 'auth',
  BLOCKED: 'blocked',
  FORBIDDEN: 'forbidden',
  NOT_DOORBIRD: 'not_doorbird',
  REFUSED: 'refused',
  HTTP: 'http',
});

export class DoorBirdError extends Error {
  constructor(kind, message, status = null) {
    super(message);
    this.name = 'DoorBirdError';
    this.kind = kind;
    this.status = status;
  }
}

export const CLIENT_TIMINGS = {
  requestTimeoutMs: 15_000,
  // A slot of the queue waits this long at most.
  queueTimeoutMs: 60_000,
};

// The web server of a door station is small: two requests at once at most
// (the event stream aside).
const MAX_IN_FLIGHT = 2;

// What the event stream follows: the two inputs the LAN API reports.
export const MONITOR_PATH = '/bha-api/monitor.cgi?ring=doorbell,motionsensor';

// A relay as info.cgi lists it: `1`, `2`, or `<controller id>@<n>`.
const RELAY_PATTERN = /^[a-z0-9]{1,16}(@\d{1,2})?$/i;

/** The relay a scene typed, cleaned; null when it cannot be one. */
export function cleanRelay(raw) {
  const text = String(raw ?? '').trim();
  return RELAY_PATTERN.test(text) ? text : null;
}

/** A MAC address as 12 upper-case hexadecimal digits; null otherwise. */
export function cleanMac(raw) {
  const hex = String(raw ?? '')
    .replace(/[^0-9a-f]/gi, '')
    .toUpperCase();
  return hex.length >= 6 && hex.length <= 16 ? hex : null;
}

/**
 * The identity of a station from the JSON of info.cgi. The wired MAC
 * (PRIMARY_MAC_ADDR) comes first, as Home Assistant keys its devices: a
 * station moved from Wi-Fi to cable keeps its identity.
 * @returns {{ mac, model, firmware, build, relays: string[] }}
 */
export function parseInfo(json) {
  const version = json?.BHA?.VERSION?.[0];
  if (!version || typeof version !== 'object') {
    throw new DoorBirdError(ERROR_KINDS.NOT_DOORBIRD, 'The answer of info.cgi is not a DoorBird');
  }
  const mac = cleanMac(version.PRIMARY_MAC_ADDR) ?? cleanMac(version.WIFI_MAC_ADDR);
  if (!mac) {
    throw new DoorBirdError(ERROR_KINDS.NOT_DOORBIRD, 'The DoorBird gave no MAC address');
  }
  const text = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);
  return {
    mac,
    model: text(version['DEVICE-TYPE']),
    firmware: text(version.FIRMWARE),
    build: text(version.BUILD_NUMBER),
    relays: Array.isArray(version.RELAYS)
      ? version.RELAYS.map((relay) => cleanRelay(relay)).filter(Boolean)
      : [],
  };
}

export class DoorBirdClient {
  /**
   * @param {object} options
   * @param {string} options.origin `http://192.0.2.10` or `https://…:port`
   * @param {string} options.username
   * @param {string} options.password
   * @param {Function} [options.request] HTTP seam (src/doorbird/http.js)
   * @param {object} [options.timings] CLIENT_TIMINGS overrides
   */
  constructor({ origin, username, password, request, timings }) {
    this.origin = origin;
    this.username = username;
    this.authorization = `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}`;
    this.http = request ?? httpRequest;
    this.timings = { ...CLIENT_TIMINGS, ...timings };
    this.blocked = false;
    this.inFlight = 0;
    this.waiting = [];
  }

  /** Talk to the device again after a refused password (user action). */
  unblock() {
    this.blocked = false;
  }

  // --- Queue ---------------------------------------------------------------------

  async slot() {
    if (this.inFlight < MAX_IN_FLIGHT) {
      this.inFlight += 1;
      return;
    }
    await new Promise((resolve, reject) => {
      const entry = { resolve };
      const timer = setTimeout(() => {
        this.waiting.splice(this.waiting.indexOf(entry), 1);
        reject(new DoorBirdError(ERROR_KINDS.UNREACHABLE, 'The DoorBird is busy'));
      }, this.timings.queueTimeoutMs);
      timer.unref?.();
      entry.resolve = () => {
        clearTimeout(timer);
        resolve();
      };
      this.waiting.push(entry);
    });
    this.inFlight += 1;
  }

  release() {
    this.inFlight -= 1;
    this.waiting.shift()?.resolve();
  }

  // --- Requests ------------------------------------------------------------------

  /**
   * One authenticated GET. The event stream resolves as soon as the device
   * accepted it and does not hold a slot of the queue.
   * @param {string} path `/bha-api/…`, already encoded
   * @param {object} [options] { stream, timeoutMs }
   * @returns {Promise<{ status, headers, body?, stream?, close? }>}
   */
  async get(path, { stream = false, timeoutMs } = {}) {
    if (this.blocked) {
      throw new DoorBirdError(
        ERROR_KINDS.BLOCKED,
        'Stopped after refused credentials: change them or test the connection',
      );
    }
    if (!stream) {
      await this.slot();
    }
    let response;
    try {
      response = await this.http(`${this.origin}${path}`, {
        headers: { Authorization: this.authorization },
        stream,
        timeoutMs: timeoutMs ?? this.timings.requestTimeoutMs,
      });
    } catch (err) {
      throw new DoorBirdError(ERROR_KINDS.UNREACHABLE, describeNetworkError(err));
    } finally {
      if (!stream) {
        this.release();
      }
    }
    if (response.status === 401) {
      response.close?.();
      // Basic authentication has no nonce to renew: a 401 is the password.
      this.blocked = true;
      throw new DoorBirdError(ERROR_KINDS.AUTH, 'User name or password refused', 401);
    }
    return response;
  }

  /** A GET whose answer must be a 200 with a body. */
  async ok(path, options) {
    const response = await this.get(path, options);
    if (response.status === 200) {
      return response;
    }
    throw httpError(response.status);
  }

  /** A GET answering the `{ "BHA": { "RETURNCODE": "1" } }` JSON of a command. */
  async command(path) {
    const response = await this.ok(path);
    const body = response.body?.toString('utf8').trim() ?? '';
    if (!body) {
      return; // some firmwares answer an empty 200
    }
    let json;
    try {
      json = JSON.parse(body);
    } catch {
      return; // not JSON: the 200 is the answer
    }
    const code = json?.BHA?.RETURNCODE;
    if (code !== undefined && String(code) !== '1') {
      throw new DoorBirdError(ERROR_KINDS.REFUSED, `The DoorBird refused the command (${code})`);
    }
  }

  // --- The API -------------------------------------------------------------------

  /** info.cgi: identity, firmware, relays. */
  async info() {
    const response = await this.ok('/bha-api/info.cgi');
    let json;
    try {
      json = JSON.parse(response.body?.toString('utf8') ?? '');
    } catch {
      throw new DoorBirdError(ERROR_KINDS.NOT_DOORBIRD, 'The answer of info.cgi is not JSON');
    }
    return parseInfo(json);
  }

  /**
   * image.cgi: a JPEG of the camera. 204: the user has no "watch always"
   * permission, and no ring in the last 5 minutes opens the image to it.
   * @returns {Promise<Buffer>}
   */
  async image({ timeoutMs } = {}) {
    const response = await this.ok('/bha-api/image.cgi', { timeoutMs });
    const bytes = response.body ?? Buffer.alloc(0);
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
      throw new DoorBirdError(ERROR_KINDS.HTTP, 'The DoorBird sent no JPEG image');
    }
    return bytes;
  }

  /** light-on.cgi: the infrared light, which goes off by itself. */
  lightOn() {
    return this.command('/bha-api/light-on.cgi');
  }

  /**
   * open-door.cgi: energize a relay. Called once, never retried: a relay
   * that clicked despite an error answer must not click twice.
   */
  openDoor(relay) {
    const clean = cleanRelay(relay);
    if (!clean) {
      return Promise.reject(new DoorBirdError(ERROR_KINDS.REFUSED, 'Unknown relay'));
    }
    return this.command(`/bha-api/open-door.cgi?r=${encodeURIComponent(clean)}`);
  }

  /** monitor.cgi: the event stream (doorbell and motion sensor). */
  monitor({ timeoutMs } = {}) {
    return this.get(MONITOR_PATH, { stream: true, timeoutMs });
  }
}

/** The error of a non-200 answer. */
export function httpError(status) {
  if (status === 204 || status === 403) {
    return new DoorBirdError(
      ERROR_KINDS.FORBIDDEN,
      `The DoorBird user lacks the permission (HTTP ${status})`,
      status,
    );
  }
  if (status === 404 || status === 501) {
    return new DoorBirdError(
      ERROR_KINDS.NOT_DOORBIRD,
      `No DoorBird LAN API at this address (HTTP ${status})`,
      status,
    );
  }
  return new DoorBirdError(ERROR_KINDS.HTTP, `The DoorBird answered HTTP ${status}`, status);
}

function describeNetworkError(err) {
  const code = err?.code ? ` (${err.code})` : '';
  return `No answer from the DoorBird${code}`;
}
