// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
//
// A DoorBird has its own users (the DoorBird App names them like
// `ghxxxx0001`): each door station has its own address, user name and
// password, two stations at most (a front door and a gate). A password lives
// in a `secret` field only: an address carrying credentials (`user:pass@host`)
// is refused rather than kept in a plain text field.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

// Minutes between two images of every DoorBird added to Gladys (`0`: only on a
// ring, a motion or a scene action). Gladys shows the last image the
// integration published.
export const SNAPSHOT_INTERVALS = ['0', '1', '5', '15', '60'];

// The configuration slots, by key suffix: one per door station.
export const SLOTS = Object.freeze(['', '_2']);

export const DEFAULT_CONFIG = {
  host: '',
  username: '',
  password: '',
  host_2: '',
  username_2: '',
  password_2: '',
  snapshot_interval: '5',
  allow_door_open: false,
  language: 'fr',
};

// A host name or an IPv4 address; an IPv6 address goes between brackets.
const HOST_PATTERN = /^([a-z0-9]([a-z0-9-]*[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i;

/**
 * One address as typed: `192.0.2.10`, `192.0.2.10:8080`, `https://door.lan`,
 * `[2001:db8::10]:80`. (From guim31/gladys-dahua.)
 * @returns {{ origin: string, label: string } | null} null when unusable
 */
export function parseHost(raw) {
  const text = String(raw ?? '').trim();
  if (!text || text.includes('@')) {
    return null;
  }
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    return null;
  }
  // A path is tolerated only when it is the API root someone copied.
  if (!['/', '/bha-api', '/bha-api/'].includes(url.pathname) || url.search || url.hash) {
    return null;
  }
  const host = url.hostname;
  const ipv6 = host.startsWith('[') && host.endsWith(']');
  if (!ipv6 && !HOST_PATTERN.test(host)) {
    return null;
  }
  return { origin: url.origin, label: url.port ? `${host}:${url.port}` : host };
}

const pickOption = (value, options, fallback) =>
  options.includes(String(value ?? '')) ? String(value) : fallback;

// A boolean field may arrive as a string from older form engines.
const flag = (value, fallback) =>
  value === undefined || value === null || value === ''
    ? fallback
    : value === true || value === 'true';

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 * @returns {{ stations: Array<{ origin, label, slot, username, password }>,
 *   invalidHosts: string[], incomplete: string[], snapshotIntervalMs: number,
 *   allowDoorOpen: boolean, language: string }}
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const text = (key) => (typeof source[key] === 'string' ? source[key].trim() : '');
  // A password may legitimately start or end with a space: kept as typed.
  const secret = (key) => (typeof source[key] === 'string' ? source[key] : '');
  const stations = [];
  const invalidHosts = [];
  // Addresses typed without their user name or password: never contacted (a
  // request with missing credentials is a refused one).
  const incomplete = [];
  const seen = new Set();
  SLOTS.forEach((suffix, index) => {
    const typed = text(`host${suffix}`);
    if (!typed) {
      return;
    }
    const host = parseHost(typed);
    if (!host) {
      // Never the entry itself in a message when it may hold a password.
      invalidHosts.push(typed.includes('@') ? '…@…' : typed);
      return;
    }
    if (seen.has(host.origin)) {
      return; // the first slot wins
    }
    seen.add(host.origin);
    const username = text(`username${suffix}`);
    const password = secret(`password${suffix}`);
    if (!username || !password) {
      incomplete.push(host.label);
      return;
    }
    stations.push({ ...host, slot: index + 1, username, password });
  });
  const language = text('language');
  return {
    stations,
    invalidHosts,
    incomplete,
    snapshotIntervalMs:
      Number(
        pickOption(source.snapshot_interval, SNAPSHOT_INTERVALS, DEFAULT_CONFIG.snapshot_interval),
      ) * 60_000,
    allowDoorOpen: flag(source.allow_door_open, DEFAULT_CONFIG.allow_door_open),
    language: LANGUAGES.includes(language) ? language : DEFAULT_CONFIG.language,
  };
}
