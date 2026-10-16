// -----------------------------------------------------------------------------
// The event stream of one door station: `monitor.cgi?ring=doorbell,motionsensor`
// kept open, an outgoing connection — the sandbox of Gladys accepts no incoming
// one, so the HTTP "favorites" a DoorBird calls on an event are out of reach.
//
// The stream is `multipart/x-mixed-replace; boundary=--ioboundary`, each part a
// `text/plain` line `doorbell:H` or `motionsensor:L` (H: active, L: idle). The
// device repeats the current state every 20 seconds or so (measured by
// Homebridge DoorBird), so 60 seconds without a byte means a dead stream: it is
// closed and opened again. The lines are read on their own, whatever the
// multipart framing around them, and handed over as they come: telling a new
// ring from a repeated state is the hub's job (src/hub.js).
//
// Reconnection, after gladys-dahua: a stream that lived and carried data
// reopens at once (a minute or more) or after 10 s; one that brought nothing
// waits 60 s, doubling up to 10 minutes. A healthy stream is recycled every
// hour (± 10 %). A refused password stops it: the client is blocked
// (src/doorbird/client.js) and only a new configuration or a test of the
// connection resumes it.
// -----------------------------------------------------------------------------

import { ERROR_KINDS } from './client.js';

export const STREAM_TIMINGS = {
  idleTimeoutMs: 60_000,
  recycleMs: 60 * 60_000,
  quickRetryMs: 10_000,
  longLifeMs: 60_000,
  failureBaseMs: 60_000,
  failureMaxMs: 10 * 60_000,
};

// The inputs of the stream, as the device names them.
export const INPUTS = Object.freeze({ DOORBELL: 'doorbell', MOTION: 'motionsensor' });

const SIGNAL = /^(doorbell|motionsensor)\s*:\s*([HL])$/i;

/** One line of the stream: `{ input, high }`, or null for anything else. */
export function parseSignal(line) {
  const match = String(line ?? '')
    .trim()
    .match(SIGNAL);
  return match ? { input: match[1].toLowerCase(), high: match[2].toUpperCase() === 'H' } : null;
}

/** Cuts a byte stream into lines; a line split across chunks is kept for later. */
export class LineSplitter {
  constructor(onLine) {
    this.onLine = onLine;
    this.rest = '';
  }

  push(chunk) {
    const text = this.rest + chunk.toString('utf8');
    const lines = text.split(/\r?\n/);
    this.rest = lines.pop() ?? '';
    // A line that never ends is not one of the stream's: drop it.
    if (this.rest.length > 4096) {
      this.rest = '';
    }
    for (const line of lines) {
      this.onLine(line);
    }
  }
}

const jitter = (ms, random) => Math.round(ms * (0.9 + 0.2 * random()));

export class MonitorStream {
  /**
   * @param {object} options
   * @param {import('./client.js').DoorBirdClient} options.client
   * @param {(signal: { input: string, high: boolean }) => void} options.onSignal
   * @param {() => void} [options.onOpen]
   * @param {(err) => void} [options.onClose] err is a DoorBirdError or an Error
   * @param {object} [options.timings] STREAM_TIMINGS overrides
   * @param {() => number} [options.random]
   * @param {() => number} [options.now]
   */
  constructor({ client, onSignal, onOpen, onClose, timings, random, now }) {
    this.client = client;
    this.onSignal = onSignal;
    this.onOpen = onOpen ?? (() => {});
    this.onClose = onClose ?? (() => {});
    this.timings = { ...STREAM_TIMINGS, ...timings };
    this.random = random ?? Math.random;
    this.now = now ?? (() => Date.now());
    this.running = false;
    this.current = null;
    this.retryTimer = null;
    this.recycleTimer = null;
    this.failures = 0;
    this.open = false;
  }

  start() {
    if (this.running) {
      return;
    }
    this.running = true;
    this.connect();
  }

  stop() {
    this.running = false;
    clearTimeout(this.retryTimer);
    clearTimeout(this.recycleTimer);
    this.current?.close?.();
    this.current = null;
    this.open = false;
  }

  /** Reconnect now (after an unblock). */
  restart() {
    this.stop();
    this.failures = 0;
    this.start();
  }

  async connect() {
    if (!this.running) {
      return;
    }
    const startedAt = this.now();
    let received = false;
    let recycled = false;
    let error = null;
    let response;
    try {
      response = await this.client.monitor({ timeoutMs: this.timings.idleTimeoutMs });
    } catch (err) {
      error = err;
    }
    if (!this.running) {
      response?.close?.();
      return;
    }
    if (response && response.status !== 200) {
      response.close?.();
      error = new Error(`The event stream was refused (HTTP ${response.status})`);
      error.kind = [204, 403].includes(response.status) ? ERROR_KINDS.FORBIDDEN : ERROR_KINDS.HTTP;
      response = null;
    }
    if (response) {
      this.current = response;
      this.open = true;
      this.onOpen();
      clearTimeout(this.recycleTimer);
      this.recycleTimer = setTimeout(
        () => {
          // Recycle: close, the loop below reopens at once.
          recycled = true;
          this.current?.close?.();
        },
        jitter(this.timings.recycleMs, this.random),
      );
      this.recycleTimer.unref?.();
      const splitter = new LineSplitter((line) => {
        const signal = parseSignal(line);
        if (signal) {
          try {
            this.onSignal(signal);
          } catch {
            // One bad signal never ends the stream.
          }
        }
      });
      try {
        for await (const chunk of response.stream) {
          if (!this.running) {
            break;
          }
          received = true;
          splitter.push(Buffer.from(chunk));
        }
        error = new Error('The event stream ended');
      } catch (err) {
        error = err;
      }
      clearTimeout(this.recycleTimer);
      response.close?.();
      this.current = null;
      this.open = false;
    }
    if (!this.running) {
      return;
    }
    error.kind ??= ERROR_KINDS.UNREACHABLE;
    if (error.kind === ERROR_KINDS.AUTH || error.kind === ERROR_KINDS.BLOCKED) {
      this.onClose(error);
      this.running = false; // resumed by restart()
      return;
    }
    const lived = this.now() - startedAt;
    let wait;
    if (recycled || (received && lived >= this.timings.longLifeMs)) {
      this.failures = 0;
      wait = 0;
    } else if (received) {
      this.failures = 0;
      wait = jitter(this.timings.quickRetryMs, this.random);
    } else {
      this.failures += 1;
      wait = jitter(
        Math.min(this.timings.failureMaxMs, this.timings.failureBaseMs * 2 ** (this.failures - 1)),
        this.random,
      );
    }
    // Reopened at once (recycled, or a long-lived stream that went quiet):
    // a routine, not an outage.
    error.routine = wait === 0;
    this.onClose(error);
    this.retryTimer = setTimeout(() => this.connect(), wait);
    this.retryTimer.unref?.();
  }
}
