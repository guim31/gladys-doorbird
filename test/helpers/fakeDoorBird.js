// -----------------------------------------------------------------------------
// A simulated DoorBird door station, built from the fixtures
// (test/fixtures/doorbird): a `request` double for the client
// (src/doorbird/http.js) that checks the HTTP Basic authentication like a
// station does, answers the LAN API (info.cgi, image.cgi, light-on.cgi,
// open-door.cgi) and keeps event streams (monitor.cgi) open, written part by
// part like the multipart stream of a station. `serve()` exposes the same
// station over real HTTP on 127.0.0.1, for the probe and the node:http
// transport (nothing leaves the machine).
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import http from 'node:http';
import { PassThrough } from 'node:stream';
import jpeg from 'jpeg-js';

process.env.LOG_LEVEL ??= 'silent';

export const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`../fixtures/doorbird/${name}`, import.meta.url), 'utf8'));

export const BOUNDARY = '--ioboundary';

/** A small valid JPEG (a grey frame). */
export function smallJpeg(width = 64, height = 36, shade = 120) {
  const data = Buffer.alloc(width * height * 4, shade);
  return Buffer.from(jpeg.encode({ width, height, data }, 80).data);
}

const json = (value, status = 200) => ({
  status,
  headers: { 'content-type': 'application/json' },
  body: Buffer.from(JSON.stringify(value)),
});

const empty = (status) => ({ status, headers: {}, body: Buffer.alloc(0) });

export class FakeDoorBird {
  /**
   * @param {object} options
   * @param {string} options.username
   * @param {string} options.password
   * @param {string} [options.info] fixture of info.cgi
   */
  constructor({ username, password, info = 'info-d2101v.json' }) {
    this.username = username;
    this.password = password;
    this.info = fixture(info);
    this.online = true;
    this.image = smallJpeg();
    this.imageStatus = 200;
    this.commandStatus = 200;
    this.requests = [];
    this.refusals = 0;
    this.lights = 0;
    this.doorsOpened = [];
    this.streams = new Set();
    this.streamAttempts = 0;
    this.streamStatus = 200;
    /** What the station reports on its stream: true is H. */
    this.states = { doorbell: false, motionsensor: false };
    this.request = this.request.bind(this);
  }

  // --- HTTP ----------------------------------------------------------------------

  /** The `request` seam of src/doorbird/http.js. */
  async request(url, { headers = {}, stream = false } = {}) {
    const target = new URL(url);
    const path = `${target.pathname}${target.search}`;
    this.requests.push({ path, authorized: Boolean(headers.Authorization) });
    if (!this.online) {
      const err = new Error('connect EHOSTUNREACH');
      err.code = 'EHOSTUNREACH';
      throw err;
    }
    if (!this.authorized(headers.Authorization)) {
      return {
        status: 401,
        headers: { 'www-authenticate': 'Basic realm="Access to DoorBird"' },
        body: Buffer.from('401 Unauthorized'),
      };
    }
    return this.answer(target, stream);
  }

  authorized(header) {
    const match = String(header ?? '').match(/^Basic\s+(.+)$/i);
    if (!match) {
      return false;
    }
    const ok =
      Buffer.from(match[1], 'base64').toString('utf8') === `${this.username}:${this.password}`;
    if (!ok) {
      this.refusals += 1;
    }
    return ok;
  }

  answer(target, stream) {
    switch (target.pathname) {
      case '/bha-api/info.cgi':
        return json(this.info);
      case '/bha-api/image.cgi':
        if (this.imageStatus !== 200) {
          return empty(this.imageStatus);
        }
        return { status: 200, headers: { 'content-type': 'image/jpeg' }, body: this.image };
      case '/bha-api/light-on.cgi':
        if (this.commandStatus !== 200) {
          return empty(this.commandStatus);
        }
        this.lights += 1;
        return json(fixture('command-ok.json'));
      case '/bha-api/open-door.cgi': {
        if (this.commandStatus !== 200) {
          return empty(this.commandStatus);
        }
        const relays = this.info.BHA.VERSION[0].RELAYS ?? ['1'];
        const relay = target.searchParams.get('r');
        if (!relays.includes(relay)) {
          return empty(400);
        }
        this.doorsOpened.push(relay);
        return json(fixture('command-ok.json'));
      }
      case '/bha-api/monitor.cgi':
        return this.openStream(target, stream);
      default:
        return empty(404);
    }
  }

  // --- Event stream ----------------------------------------------------------------

  openStream(target, stream) {
    if (!stream) {
      throw new Error('The event stream must be requested as a stream');
    }
    if (target.searchParams.get('ring') !== 'doorbell,motionsensor') {
      return empty(400);
    }
    this.streamAttempts += 1;
    if (this.streamStatus !== 200) {
      return empty(this.streamStatus);
    }
    const body = new PassThrough();
    this.streams.add(body);
    body.on('close', () => this.streams.delete(body));
    // The current state, at once.
    body.write(this.part('doorbell'));
    body.write(this.part('motionsensor'));
    return {
      status: 200,
      headers: { 'content-type': `multipart/x-mixed-replace; boundary=${BOUNDARY}` },
      stream: body,
      close: () => body.destroy(),
    };
  }

  part(input) {
    return `${BOUNDARY}\r\nContent-Type: text/plain\r\n\r\n${input}:${this.states[input] ? 'H' : 'L'}\r\n\r\n`;
  }

  /** Change an input and write it on every open stream. */
  set(input, high) {
    this.states[input] = high;
    for (const stream of this.streams) {
      stream.write(this.part(input));
    }
  }

  /** A press of the button: H, then L. */
  ring() {
    this.set('doorbell', true);
    this.set('doorbell', false);
  }

  /** The periodic repeat of the current state. */
  heartbeat() {
    for (const stream of this.streams) {
      stream.write(this.part('doorbell'));
      stream.write(this.part('motionsensor'));
    }
  }

  /** Close every open stream, as a station rebooting does. */
  dropStreams() {
    for (const stream of this.streams) {
      stream.destroy();
    }
  }

  // --- Real HTTP ------------------------------------------------------------------

  /** Serve this station on 127.0.0.1; resolves `{ origin, close }`. */
  serve() {
    const server = http.createServer(async (req, res) => {
      const url = `http://${req.headers.host}${req.url}`;
      const answer = await this.request(url, {
        headers: { Authorization: req.headers.authorization },
        stream: req.url.includes('monitor.cgi'),
      }).catch(() => ({ status: 500, headers: {}, body: Buffer.from('Error') }));
      res.writeHead(answer.status, answer.headers);
      if (answer.stream) {
        // A station sends the headers of its stream at once.
        res.flushHeaders();
        answer.stream.pipe(res);
        res.on('close', () => answer.close());
      } else {
        res.end(answer.body);
      }
    });
    return new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const { port } = server.address();
        resolve({
          origin: `http://127.0.0.1:${port}`,
          close: () =>
            new Promise((done) => {
              server.closeAllConnections();
              server.close(done);
            }),
        });
      });
    });
  }
}

/**
 * Several stations behind one `request` seam, routed by origin.
 * @param {Record<string, FakeDoorBird>} byOrigin
 */
export function network(byOrigin) {
  return (url, options) => {
    const station = byOrigin[new URL(url).origin];
    if (!station) {
      const err = new Error('connect EHOSTUNREACH');
      err.code = 'EHOSTUNREACH';
      return Promise.reject(err);
    }
    return station.request(url, options);
  };
}
