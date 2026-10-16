#!/usr/bin/env node
// -----------------------------------------------------------------------------
// Read-only probe of a real DoorBird, with the very client of the integration:
// what the integration would see, without Gladys.
//
//   node scripts/probe.mjs <address>
//       without credentials: checks that a DoorBird LAN API answers there
//       (an unauthenticated info.cgi must be refused with a 401), nothing more;
//   DOORBIRD_PASSWORD=… node scripts/probe.mjs <address> <user> [seconds]
//       reads info.cgi (model, firmware, relays), takes one image, and listens
//       to the event stream (30 seconds by default), printing each line
//       (`doorbell:H`, `motionsensor:L`) with its time: ring, walk by.
//
// It writes nothing to the DoorBird: no light, no relay, no favorite, no
// schedule. It prints neither the password nor the full MAC address (its last
// 4 characters only). One refused password stops it at once.
//
// Not part of the Docker image (only index.js and src/ are copied).
// -----------------------------------------------------------------------------

import { parseHost } from '../src/config.js';
import { DoorBirdClient } from '../src/doorbird/client.js';
import { request } from '../src/doorbird/http.js';
import { LineSplitter, parseSignal } from '../src/doorbird/monitor.js';
import { jpegSize } from '../src/image.js';

const [address, user, seconds = '30'] = process.argv.slice(2);
const password = process.env.DOORBIRD_PASSWORD ?? '';
const host = parseHost(address);
if (!host || (user && !password)) {
  console.error('Usage: node scripts/probe.mjs <address>');
  console.error('       DOORBIRD_PASSWORD=… node scripts/probe.mjs <address> <user> [seconds]');
  process.exit(2);
}

const mask = (mac) => (mac ? `…${String(mac).slice(-4)}` : '?');
const line = (label, value) => console.log(`${label.padEnd(22)} ${value}`);

line('Address', host.label);

if (!user) {
  // No credentials: no Authorization header, so nothing a lockout counts.
  try {
    const answer = await request(`${host.origin}/bha-api/info.cgi`, { timeoutMs: 10_000 });
    line('info.cgi without user', `HTTP ${answer.status}`);
    const realm = answer.headers['www-authenticate'];
    if (realm) {
      line('Authentication', String(realm).split(' ')[0]);
    }
    console.log(
      answer.status === 401
        ? 'A DoorBird LAN API answers here: run again with a user and DOORBIRD_PASSWORD.'
        : 'Not the answer of a DoorBird (a 401 was expected).',
    );
    process.exit(answer.status === 401 ? 0 : 1);
  } catch (err) {
    console.error(`No answer from ${host.label}: ${err.message}`);
    process.exit(1);
  }
}

const client = new DoorBirdClient({ origin: host.origin, username: user, password });

let info;
try {
  info = await client.info();
} catch (err) {
  console.error(`Cannot read ${host.label}: ${err.message} (${err.kind ?? 'error'})`);
  process.exit(1);
}
line('Model', info.model ?? '? (firmware before 000108)');
line('Firmware', `${info.firmware ?? '?'} build ${info.build ?? '?'}`);
line('MAC', mask(info.mac));
line('Relays', info.relays.length > 0 ? info.relays.join(', ') : 'none listed');

try {
  const started = Date.now();
  const bytes = await client.image();
  const size = jpegSize(bytes);
  line(
    'Image',
    `${Math.round(bytes.length / 1024)} KB, ${size ? `${size.width}×${size.height}` : '?'}, ${Date.now() - started} ms`,
  );
} catch (err) {
  line('Image', `failed: ${err.message} (${err.kind ?? 'error'})`);
}

console.log(`\nListening to the events for ${seconds} s (ring, walk in front of the camera)…`);
let response;
try {
  response = await client.monitor({ timeoutMs: 60_000 });
} catch (err) {
  console.error(`Event stream: ${err.message} (${err.kind ?? 'error'})`);
  process.exit(1);
}
line('Event stream', `HTTP ${response.status}, ${response.headers?.['content-type'] ?? '?'}`);
if (response.status !== 200) {
  process.exit(1);
}
const startedAt = Date.now();
const splitter = new LineSplitter((text) => {
  const signal = parseSignal(text);
  if (signal) {
    const at = ((Date.now() - startedAt) / 1000).toFixed(1).padStart(6);
    console.log(`${at} s  ${signal.input}:${signal.high ? 'H' : 'L'}`);
  } else if (text.trim() && !/^--|^content-/i.test(text.trim())) {
    console.log(`        (other line: ${text.trim().slice(0, 80)})`);
  }
});
const timer = setTimeout(() => response.close(), Number(seconds) * 1000);
try {
  for await (const chunk of response.stream) {
    splitter.push(Buffer.from(chunk));
  }
} catch {
  // closed at the end of the listening time
}
clearTimeout(timer);
console.log('Done.');
process.exit(0);
