// -----------------------------------------------------------------------------
// The DoorBird hub: every configured door station, followed live and read
// again on a timer.
//
//   - each station is read at start (info.cgi: model, firmware, MAC address,
//     relays) and its identity kept in /data, so a station that is off at the
//     next start keeps its device in Gladys;
//   - its event stream (src/doorbird/monitor.js): the doorbell and the motion
//     sensor, as they happen. A ring is a pulse (1, then 0 a few seconds
//     later), as the core expects for a doorbell; motion stays 1 while the
//     station reports it;
//   - info.cgi is read again every 5 minutes, every minute while the event
//     stream is down: the container refreshes itself, Gladys never polls
//     (should_poll: false, GladysAssistant/Gladys#3198);
//   - images: a fresh one at each ring and motion (before the scene event, so
//     a scene sending "the camera image" sends the right one), on the timer
//     chosen in the configuration, on demand.
//
// A new ring or motion is a change from idle (L) to active (H): the stream
// repeats the current state every 20 seconds, and a state seen for the first
// time (at start) is not an event.
//
// States go through publishChangedStates (only the changes, plus a heartbeat
// every 6 hours: the front shows "no recent value" past 48 hours), and only
// for the devices the user added: Gladys drops the others.
//
// Logs: info keeps the lifecycle (connected, a station lost and back, user
// commands); a problem that repeats is logged once, and once when it clears;
// the rest goes to debug (LOG_LEVEL=debug). Never a password, never an
// address with credentials.
// (Structure from guim31/gladys-dahua.)
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { DoorBirdClient, ERROR_KINDS, cleanRelay } from './doorbird/client.js';
import { INPUTS, MonitorStream } from './doorbird/monitor.js';
import { FEATURE_KEYS, buildDevice, featureValues, stationIds, stationName } from './devices.js';
import { toCameraImage } from './image.js';
import { ACTION_TEXT, CONNECTION_TEXT, ERROR_TEXT, REPORT_TEXT, localized, pick } from './texts.js';

const logger = createLogger({ name: 'doorbird-hub' });

export const WIDGET_KEY = 'doorbird';

// Scene trigger keys (manifest `scene_triggers`): permanent once published.
export const TRIGGERS = Object.freeze({
  DOORBELL: 'doorbell_pressed',
  MOTION: 'motion_detected',
});

// What the widget and the triggers remember of an event.
export const EVENT_KINDS = Object.freeze({ RING: 'ring', MOTION: 'motion' });

export const HUB_TIMINGS = {
  refreshMs: 5 * 60_000,
  // While an event stream is down, the reads say at least whether it answers.
  fallbackRefreshMs: 60_000,
  heartbeatMs: 6 * 60 * 60_000,
  // A ring: 1, then 0 after this.
  pulseMs: 10_000,
  // One scene event per ring or motion in this window, per station.
  triggerSpacingMs: 15_000,
  // The core takes 12 images a minute per camera at most.
  imageSpacingMs: 6_000,
  // A scene event waits this long at most for the fresh image of its station.
  eventImageWaitMs: 4_000,
  // The infrared light goes off by itself after about 3 minutes.
  irLightMs: 180_000,
};

// Events kept for the widget (with their image) and counted over 24 h.
export const MAX_EVENTS = 8;
const DAY_MS = 24 * 60 * 60_000;
const MAX_COUNTED = 5000;

const delay = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms).unref?.();
  });

const stationsSignature = (config) =>
  JSON.stringify(config.stations.map((s) => [s.origin, s.username, s.password]));

/** One configured door station, and what the hub knows of it. */
class Station {
  constructor(host, client) {
    this.host = host;
    this.origin = host.origin;
    this.label = host.label;
    this.client = client;
    /** { mac, model, firmware, build, relays }, from info.cgi or /data. */
    this.info = null;
    this.read = { ok: null, error: null, downSince: null };
    this.stream = null;
    /** Last state of each input of the stream: true (H), false (L), null (unknown). */
    this.signals = { [INPUTS.DOORBELL]: null, [INPUTS.MOTION]: null };
    this.motion = false;
    this.ringTimer = null;
    this.irTimer = null;
    this.irLight = false;
    this.image = null;
    this.imageRead = null;
    this.imageError = null;
  }

  get key() {
    return this.info?.mac ?? null;
  }

  /** What src/devices.js needs. */
  get descriptor() {
    return { ...this.info, host: this.label };
  }
}

export class DoorBirdHub {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK's fake Gladys)
   * @param {object} options.store persistence (src/store.js)
   * @param {Function} [options.request] HTTP seam (src/doorbird/http.js)
   * @param {Function} [options.toImage] JPEG → camera image (src/image.js)
   * @param {boolean} [options.timers] periodic timers (off in most tests)
   * @param {object} [options.timings] HUB_TIMINGS overrides
   * @param {object} [options.streamTimings] STREAM_TIMINGS overrides
   * @param {object} [options.clientTimings] CLIENT_TIMINGS overrides
   * @param {() => number} [options.now]
   */
  constructor({
    gladys,
    store,
    request,
    toImage,
    timers = true,
    timings,
    streamTimings,
    clientTimings,
    now,
  }) {
    this.gladys = gladys;
    this.store = store;
    this.request = request;
    this.toImage = toImage ?? toCameraImage;
    this.timersEnabled = timers;
    this.timings = { ...HUB_TIMINGS, ...timings };
    this.streamTimings = streamTimings;
    this.clientTimings = clientTimings;
    this.now = now ?? (() => Date.now());
    this.config = null;
    this.signature = null;
    /** By origin. */
    this.stations = new Map();
    this.saved = { stations: {} };
    this.reading = null;
    this.discovery = null;
    this.lastTriggers = new Map();
    /** Events, newest first: { id, at, key, kind, imageKey }. */
    this.events = [];
    /** Every event of the last 24 hours, for the counts: { at, key, kind }. */
    this.counted = [];
    this.eventCount = 0;
    this.thumbnails = new Map();
    this.online = new Map();
    this.transports = new Map();
    this.connection = null;
    this.refreshTimer = null;
    this.snapshotTimer = null;
    this.stopped = false;
    /** Problems already logged, by key: their repeats go to debug. */
    this.warned = new Set();
  }

  get language() {
    return this.config?.language ?? 'en';
  }

  // --- Logs ------------------------------------------------------------------

  /** Log a problem once (`level` info, warn or error), its repeats at debug. */
  problem(key, message, level = 'warn') {
    if (this.warned.has(key)) {
      logger.debug(message);
      return;
    }
    this.warned.add(key);
    logger[level](message);
  }

  /** The problem `key` is gone: say so once, the next occurrence logs again. */
  resolved(key, message) {
    if (this.warned.delete(key) && message) {
      logger.info(message);
    }
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(config) {
    const saved = await this.store.load();
    this.saved = {
      stations: saved.stations && typeof saved.stations === 'object' ? saved.stations : {},
    };
    await this.reconfigure(config);
  }

  /** Gladys reconnected (it restarted): send everything again. */
  async resync(config) {
    this.gladys.forgetPublishedStates?.();
    this.transports.clear();
    this.connection = null;
    this.discovery = null;
    await this.reconfigure(config);
  }

  async reconfigure(config) {
    const next = stationsSignature(config);
    const changed = next !== this.signature;
    this.config = config;
    if (changed) {
      this.closeStreams();
      this.clearStationTimers();
      this.signature = next;
      this.stations.clear();
      this.online.clear();
      for (const host of config.stations) {
        const client = new DoorBirdClient({
          origin: host.origin,
          username: host.username,
          password: host.password,
          request: this.request,
          timings: this.clientTimings,
        });
        const station = new Station(host, client);
        station.info = restoreInfo(this.saved.stations[host.origin]);
        this.stations.set(host.origin, station);
      }
      if (config.invalidHosts.length > 0) {
        this.problem(
          'invalid-hosts',
          `Addresses not understood in the configuration: ${config.invalidHosts.join(', ')}`,
        );
      } else {
        this.resolved('invalid-hosts');
      }
    }
    // A new language renames the features: the Discovery tab shows them.
    this.discovery = null;
    if (this.stations.size === 0) {
      clearTimeout(this.refreshTimer);
      clearTimeout(this.snapshotTimer);
      await this.publishDevices();
      await this.publishConnectionStatus();
      return;
    }
    await this.refresh();
    if (changed) {
      this.openStreams();
    }
    this.scheduleRefresh();
    this.scheduleSnapshots();
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.refreshTimer);
    clearTimeout(this.snapshotTimer);
    this.closeStreams();
    this.clearStationTimers();
    await this.store.flush();
  }

  clearStationTimers() {
    for (const station of this.stations.values()) {
      clearTimeout(station.ringTimer);
      clearTimeout(station.irTimer);
    }
  }

  scheduleRefresh() {
    clearTimeout(this.refreshTimer);
    if (!this.timersEnabled || this.stopped || this.stations.size === 0) {
      return;
    }
    const allLive = [...this.stations.values()].every((station) => station.stream?.open);
    const wait = allLive ? this.timings.refreshMs : this.timings.fallbackRefreshMs;
    this.refreshTimer = setTimeout(async () => {
      await this.refresh();
      this.scheduleRefresh();
    }, wait);
  }

  scheduleSnapshots() {
    clearTimeout(this.snapshotTimer);
    const interval = this.config?.snapshotIntervalMs ?? 0;
    if (!this.timersEnabled || this.stopped || this.stations.size === 0 || interval <= 0) {
      return;
    }
    this.snapshotTimer = setTimeout(async () => {
      await this.snapshotAll();
      this.scheduleSnapshots();
    }, interval);
  }

  // --- Stations ------------------------------------------------------------------

  /** The stations already identified (their MAC address is known). */
  known() {
    return [...this.stations.values()].filter((station) => station.info);
  }

  /** The name of a station, told apart from a twin of the same model. */
  nameOf(station) {
    return stationName(
      station.info ?? { mac: station.label, model: null },
      this.known().map((other) => other.info),
    );
  }

  idsOf(station) {
    return stationIds(this.gladys, station.info);
  }

  /** The station of a Gladys external id, null when unknown. */
  findStation(externalId) {
    if (!externalId) {
      return null;
    }
    return this.known().find((station) => this.idsOf(station).device === externalId) ?? null;
  }

  isOnline(station) {
    return Boolean(station.read.ok === true || station.stream?.open);
  }

  // --- Reading the stations ----------------------------------------------------------

  /** Read every station. Concurrent calls share the read. */
  refresh() {
    this.reading ??= this.readAll().finally(() => {
      this.reading = null;
    });
    return this.reading;
  }

  async readAll() {
    const stations = [...this.stations.values()];
    const results = await Promise.all(stations.map((station) => this.readStation(station)));
    if (
      this.stations.size === 0 ||
      stations.some((station) => this.stations.get(station.origin) !== station)
    ) {
      return false; // reconfigured while reading
    }
    await this.publishDevices();
    await this.publishAllStates();
    await this.afterChanges();
    return results.every(Boolean);
  }

  async readStation(station) {
    let info;
    try {
      info = await station.client.info();
    } catch (err) {
      if (this.stations.get(station.origin) === station) {
        this.readFailed(station, err);
      }
      return false;
    }
    if (this.stations.get(station.origin) !== station) {
      return false;
    }
    if (JSON.stringify(info) !== JSON.stringify(station.info)) {
      if (station.info && station.info.mac !== info.mac) {
        // Another station now answers at this address: a new device.
        logger.info(`Another DoorBird answers at ${station.label}`);
      }
      station.info = info;
      this.saved.stations[station.origin] = info;
      this.save();
    }
    this.readSucceeded(station);
    return true;
  }

  readSucceeded(station) {
    const read = station.read;
    const first = read.ok === null;
    const wasDown = read.ok === false;
    read.ok = true;
    read.error = null;
    const info = station.info;
    const label = `${info.model ?? 'DoorBird'} at ${station.label}`;
    if (first) {
      logger.info(
        `Connected to ${label}: firmware ${info.firmware ?? '?'}, ${info.relays.length} relay(s)`,
      );
    } else if (wasDown) {
      const minutes = Math.max(1, Math.round((this.now() - read.downSince) / 60_000));
      logger.info(`${label} answers again after ${minutes} min`);
    }
    this.warned.delete(`read-${station.origin}`);
    read.downSince = null;
    // A stream stopped by a refused password resumes once the station answers.
    if (station.stream && !station.stream.running && !this.stopped) {
      station.stream.restart();
    }
  }

  readFailed(station, err) {
    const read = station.read;
    if (read.ok !== false) {
      read.downSince = this.now();
    }
    read.ok = false;
    read.error = err;
    const level = err.kind === ERROR_KINDS.UNREACHABLE ? 'info' : 'warn';
    this.problem(
      `read-${station.origin}`,
      `Cannot read the DoorBird at ${station.label}: ${err.message}`,
      level,
    );
    if (err.kind === ERROR_KINDS.AUTH || err.kind === ERROR_KINDS.BLOCKED) {
      station.stream?.stop();
    }
  }

  save() {
    return this.store.save({ stations: this.saved.stations });
  }

  // --- Event streams -----------------------------------------------------------------

  openStreams() {
    this.closeStreams();
    if (this.stopped) {
      return;
    }
    for (const station of this.stations.values()) {
      station.stream = new MonitorStream({
        client: station.client,
        onSignal: (signal) =>
          this.onSignal(station, signal).catch((err) =>
            this.problem(
              `signal-${station.origin}`,
              `Cannot handle an event of ${station.label}: ${err.message}`,
            ),
          ),
        onOpen: () => this.streamOpened(station),
        onClose: (err) => this.streamClosed(station, err),
        timings: this.streamTimings,
        now: this.now,
      });
      station.stream.start();
    }
  }

  closeStreams() {
    for (const station of this.stations.values()) {
      station.stream?.stop();
    }
  }

  streamOpened(station) {
    this.resolved(`stream-${station.origin}`, `Live events of ${station.label}: connected again`);
    logger.debug(`Event stream of ${station.label} open`);
    this.scheduleRefresh();
    this.afterChanges().catch(() => {});
  }

  streamClosed(station, err) {
    if (err.kind === ERROR_KINDS.BLOCKED || err.routine) {
      // A refused password: already said by the read that met it. A stream
      // recycled or gone quiet after a long life: reopened at once, a routine.
      logger.debug(`Live events of ${station.label} closed: ${err.message}`);
    } else {
      // A station lost is lifecycle (info); a refused password or a forbidden
      // stream is a problem to fix (warn). Once per outage either way.
      const level = err.kind === ERROR_KINDS.UNREACHABLE ? 'info' : 'warn';
      this.problem(
        `stream-${station.origin}`,
        `Live events of ${station.label} interrupted: ${err.message}`,
        level,
      );
    }
    // Its end of motion is lost while it is closed: nothing stays detected.
    if (station.motion) {
      station.motion = false;
      this.publishStates(station).catch(() => {});
    }
    if (err.kind === ERROR_KINDS.AUTH || err.kind === ERROR_KINDS.BLOCKED) {
      if (station.read.ok !== false) {
        station.read.downSince = this.now();
      }
      station.read.ok = false;
      station.read.error = err;
    }
    this.scheduleRefresh();
    this.afterChanges().catch(() => {});
  }

  /** A line of the stream: `doorbell:H`, `motionsensor:L`… */
  async onSignal(station, { input, high }) {
    const before = station.signals[input];
    station.signals[input] = high;
    if (!station.info || before === high) {
      return; // the repeated state of the stream
    }
    // A change from idle to active is an event; active at first sight is not
    // (it may be a ring of minutes ago).
    const started = high && before === false;
    logger.debug(`${this.nameOf(station)}: ${input} ${high ? 'active' : 'idle'}`);
    if (input === INPUTS.MOTION) {
      station.motion = high;
      await this.publishStates(station);
      if (started) {
        await this.announce(station, EVENT_KINDS.MOTION);
      }
    } else if (input === INPUTS.DOORBELL && started) {
      this.pulseRing(station);
      await this.publishStates(station);
      await this.announce(station, EVENT_KINDS.RING);
    }
  }

  // --- Rings, motions and their scene events ------------------------------------------

  /** One trigger per station and window: true when this one may fire. */
  mayFire(trigger, station) {
    const id = `${trigger}:${station.key}`;
    const last = this.lastTriggers.get(id);
    if (last !== undefined && this.now() - last < this.timings.triggerSpacingMs) {
      return false;
    }
    this.lastTriggers.set(id, this.now());
    return true;
  }

  /** A ring or a motion: remember it with its image, then the scene event. */
  async announce(station, kind) {
    const trigger = kind === EVENT_KINDS.RING ? TRIGGERS.DOORBELL : TRIGGERS.MOTION;
    this.count(station, kind);
    if (!this.mayFire(trigger, station)) {
      return;
    }
    const event = this.remember(station, kind);
    await this.imageFor(station, event);
    await this.fire(trigger, {
      doorbird: this.idsOf(station).device,
      doorbird_name: this.nameOf(station),
    });
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
  }

  /** Count an event for the 24-hour tiles of the widget. */
  count(station, kind) {
    this.counted.push({ at: this.now(), key: station.key, kind });
    if (this.counted.length > MAX_COUNTED) {
      this.counted.splice(0, this.counted.length - MAX_COUNTED);
    }
  }

  /** Keep an event for the widget. */
  remember(station, kind) {
    this.eventCount += 1;
    const event = {
      id: `${this.now().toString(36)}${this.eventCount.toString(36)}`,
      at: this.now(),
      key: station.key,
      kind,
      imageKey: null,
    };
    this.events.unshift(event);
    for (const dropped of this.events.splice(MAX_EVENTS)) {
      this.thumbnails.delete(dropped.imageKey);
    }
    return event;
  }

  /** Events of a kind over the last 24 hours, of one station or all. */
  eventsToday(kind, key = null) {
    const since = this.now() - DAY_MS;
    this.counted = this.counted.filter((entry) => entry.at >= since);
    return this.counted.filter((entry) => entry.kind === kind && (!key || entry.key === key))
      .length;
  }

  /** A fresh image for an event, waited for a few seconds at most. */
  async imageFor(station, event) {
    const read = this.cameraImage(station).then((image) => {
      if (image && !event.imageKey) {
        event.imageKey = `ev-${event.id.replace(/[^a-z0-9]/g, '').slice(0, 40)}`;
        this.thumbnails.set(event.imageKey, image.slice(image.indexOf(',') + 1));
      }
    });
    await Promise.race([read, delay(this.timings.eventImageWaitMs)]);
  }

  async fire(key, data) {
    try {
      await this.gladys.publishSceneEvent(key, data);
      this.resolved('scene-event');
    } catch (err) {
      this.problem('scene-event', `Scene event ${key} refused: ${err.message}`);
    }
  }

  /** A ring: 1 now, 0 after `pulseMs`. */
  pulseRing(station) {
    clearTimeout(station.ringTimer);
    station.ringTimer = setTimeout(() => {
      station.ringTimer = null;
      if (!this.stopped && this.stations.get(station.origin) === station) {
        this.publishStates(station).catch(() => {});
      }
    }, this.timings.pulseMs);
    station.ringTimer.unref?.();
  }

  // --- Publishing to Gladys ----------------------------------------------------

  /** Whether the user added the device to Gladys. */
  isCreated(externalId) {
    return (this.gladys.devices ?? []).some((device) => device.external_id === externalId);
  }

  async publishDevices() {
    const all = this.known().map((station) => station.info);
    const devices = this.known().map((station) =>
      buildDevice(this.gladys, station.descriptor, { language: this.language, all }),
    );
    const key = JSON.stringify(devices);
    if (key === this.discovery) {
      return;
    }
    try {
      // Even an empty list: the Discovery tab then shows no stale device.
      await this.gladys.publishDiscoveredDevices(devices);
      this.discovery = key;
      this.resolved('discovery');
    } catch (err) {
      this.problem('discovery', `Discovered devices refused: ${err.message}`);
    }
  }

  /** "Search" in the Discovery tab: read the stations again. */
  async rediscover() {
    this.discovery = null;
    if (!(await this.refresh())) {
      await this.publishDevices();
    }
  }

  /** The user added a device: the SDK forgot its values, send them again. */
  async onDeviceCreated(device) {
    const station = this.findStation(device.external_id);
    if (!station) {
      return;
    }
    await this.publishStates(station);
    await this.publishTransports();
    if (this.isOnline(station)) {
      this.cameraImage(station).catch(() => {});
    }
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
  }

  async publishAllStates() {
    for (const station of this.known()) {
      await this.publishStates(station);
    }
  }

  /** The current values of one station, sent if they changed. */
  async publishStates(station) {
    if (!station.info) {
      return;
    }
    const ids = this.idsOf(station);
    if (!this.isCreated(ids.device)) {
      return;
    }
    const values = featureValues({
      online: this.isOnline(station),
      ring: station.ringTimer !== null,
      motion: station.motion,
      irLight: station.irLight,
    });
    const states = Object.entries(values).map(([key, state]) => ({
      device_feature_external_id: ids.feature(key),
      state,
    }));
    try {
      await this.gladys.publishChangedStates(states, { heartbeat: this.timings.heartbeatMs });
      this.resolved('states');
    } catch (err) {
      this.problem('states', `States of ${this.nameOf(station)} refused: ${err.message}`);
    }
  }

  /** After any change: stations offline and back, transports, status, widget. */
  async afterChanges() {
    let changed = false;
    for (const station of this.stations.values()) {
      const online = this.isOnline(station);
      const before = this.online.get(station.origin);
      if (before !== online) {
        changed = true;
        if (before !== undefined) {
          logger.info(`${station.label} is ${online ? 'online again' : 'offline'}`);
          await this.publishStates(station);
        }
      }
      this.online.set(station.origin, online);
    }
    await this.publishTransports();
    await this.publishConnectionStatus();
    if (changed) {
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
    }
  }

  async publishTransports() {
    const entries = [];
    for (const station of this.known()) {
      const externalId = this.idsOf(station).device;
      if (!this.isCreated(externalId)) {
        continue;
      }
      const transport = this.isOnline(station)
        ? DEVICE_TRANSPORTS.LOCAL
        : DEVICE_TRANSPORTS.UNREACHABLE;
      if (this.transports.get(externalId) !== transport) {
        entries.push({ external_id: externalId, transport });
      }
    }
    if (entries.length === 0) {
      return;
    }
    try {
      await this.gladys.publishTransports(entries);
      for (const entry of entries) {
        this.transports.set(entry.external_id, entry.transport);
      }
      this.resolved('transports');
    } catch (err) {
      this.problem('transports', `Transports refused: ${err.message}`);
    }
  }

  /** The status under the integration name, in the Configuration screen. */
  connectionStatus() {
    const config = this.config;
    if (!config || config.stations.length === 0) {
      let message = CONNECTION_TEXT.noHost;
      if (config?.incomplete.length > 0) {
        message = CONNECTION_TEXT.incomplete;
      } else if (config?.invalidHosts.length > 0) {
        message = CONNECTION_TEXT.invalidHost;
      }
      return { connected: false, message };
    }
    const reads = [...this.stations.values()].map((station) => station.read);
    if (reads.some((read) => read.ok === null)) {
      return null; // first read not done yet
    }
    const failed = reads.filter((read) => read.ok === false);
    const refused = failed.find((read) =>
      [ERROR_KINDS.AUTH, ERROR_KINDS.BLOCKED].includes(read.error?.kind),
    );
    if (refused) {
      return { connected: false, message: ERROR_TEXT[ERROR_KINDS.BLOCKED] };
    }
    if (failed.length === reads.length) {
      return {
        connected: false,
        message: ERROR_TEXT[failed[0].error?.kind] ?? ERROR_TEXT[ERROR_KINDS.HTTP],
      };
    }
    if (config.incomplete.length > 0) {
      return { connected: true, message: CONNECTION_TEXT.incomplete };
    }
    if (failed.length > 0 || config.invalidHosts.length > 0) {
      return { connected: true, message: CONNECTION_TEXT.someDown };
    }
    // A stream still connecting at start is not news: only a lost one is.
    const lost = [...this.stations.values()].some(
      (station) => !station.stream?.open && this.warned.has(`stream-${station.origin}`),
    );
    if (lost) {
      return { connected: true, message: CONNECTION_TEXT.live };
    }
    return { connected: true };
  }

  async publishConnectionStatus() {
    const status = this.connectionStatus();
    if (!status) {
      return;
    }
    const key = JSON.stringify(status);
    if (key === this.connection) {
      return;
    }
    try {
      await this.gladys.setConnectionStatus(status.connected, status.message);
      this.connection = key;
      this.resolved('connection-status');
    } catch (err) {
      this.problem('connection-status', `Connection status refused: ${err.message}`);
    }
  }

  // --- Camera images -------------------------------------------------------------

  /**
   * A fresh image of a station, sent to Gladys when the device is added.
   * Concurrent calls share the read; a read younger than `imageSpacingMs` is
   * reused (the core takes 12 images a minute per camera).
   * @returns {Promise<string|null>} the `image/jpg;base64,…` string
   */
  cameraImage(station) {
    const last = station.image;
    if (last && this.now() - last.at < this.timings.imageSpacingMs) {
      return Promise.resolve(last.image);
    }
    station.imageRead ??= this.readImage(station).finally(() => {
      station.imageRead = null;
    });
    return station.imageRead;
  }

  async readImage(station) {
    let image;
    try {
      const bytes = await station.client.image();
      image = await this.toImage(bytes);
      station.imageError = null;
      this.resolved(`image-${station.origin}`, `Images of ${station.label}: back`);
    } catch (err) {
      station.imageError = err;
      this.problem(`image-${station.origin}`, `No image from ${station.label}: ${err.message}`);
      return null;
    }
    station.image = { at: this.now(), image };
    if (station.info && this.isCreated(this.idsOf(station).device)) {
      try {
        await this.gladys.publishCameraImage(this.idsOf(station).device, image);
        this.resolved('camera-image');
      } catch (err) {
        this.problem('camera-image', `Image of ${station.label} refused: ${err.message}`);
      }
    }
    return image;
  }

  /** The timer of the configuration: every added station online, one after the other. */
  async snapshotAll() {
    const half = (this.config?.snapshotIntervalMs ?? 0) / 2;
    for (const station of this.known()) {
      const last = station.image;
      // Skip a station imaged less than half a period ago (an event did it).
      if (
        !this.isOnline(station) ||
        !this.isCreated(this.idsOf(station).device) ||
        (last && this.now() - last.at < half)
      ) {
        continue;
      }
      await this.cameraImage(station);
    }
  }

  /** Gladys asks for a fresh image (scene "send camera image", AI). */
  async getImage(device) {
    const station = this.findStation(device.external_id);
    if (!station) {
      throw new Error(pick(ACTION_TEXT.unknownDoorBird, this.language));
    }
    const image = await this.cameraImage(station);
    if (!image) {
      throw new Error(pick(ACTION_TEXT.snapshotFailed, this.language));
    }
    return image;
  }

  // --- Commands --------------------------------------------------------------------

  requireStation(externalId) {
    if (this.stations.size === 0) {
      throw new Error(pick(ACTION_TEXT.notConfigured, this.language));
    }
    if (!externalId) {
      throw new Error(pick(ACTION_TEXT.pickDoorBird, this.language));
    }
    const station = this.findStation(externalId);
    if (!station) {
      throw new Error(pick(ACTION_TEXT.unknownDoorBird, this.language));
    }
    return station;
  }

  /** The command of a feature: the infrared light. */
  async setValue(device, feature, value) {
    const station = this.findStation(device.external_id);
    if (!station || feature.external_id !== this.idsOf(station).feature(FEATURE_KEYS.IR_LIGHT)) {
      throw new Error(`No command for ${feature.external_id}`);
    }
    if (Number(value) !== 1) {
      throw new Error(pick(ACTION_TEXT.irOff, this.language));
    }
    await this.lightOn(station);
  }

  /** The infrared light: on now, off by itself after about 3 minutes. */
  async lightOn(station) {
    try {
      await station.client.lightOn();
    } catch (err) {
      logger.warn(`${this.nameOf(station)}: infrared light not switched on: ${err.message}`);
      throw new Error(pick(ERROR_TEXT[err.kind] ?? ERROR_TEXT[ERROR_KINDS.HTTP], this.language), {
        cause: err,
      });
    }
    logger.info(`${this.nameOf(station)}: infrared light on`);
    station.irLight = true;
    clearTimeout(station.irTimer);
    station.irTimer = setTimeout(() => {
      station.irTimer = null;
      station.irLight = false;
      if (!this.stopped && this.stations.get(station.origin) === station) {
        this.publishStates(station).catch(() => {});
      }
    }, this.timings.irLightMs);
    station.irTimer.unref?.();
    await this.publishStates(station);
  }

  /** Scene action and widget: a fresh image now, sent to Gladys. */
  async refreshImage(externalId) {
    const station = this.requireStation(externalId);
    logger.info(`Scene action: fresh image of ${this.nameOf(station)}`);
    const image = await this.cameraImage(station);
    if (!image) {
      throw new Error(
        pick(ERROR_TEXT[station.imageError?.kind] ?? ACTION_TEXT.snapshotFailed, this.language),
      );
    }
    return image;
  }

  /**
   * Scene action: energize a relay (door strike, gate). Disabled unless
   * allowed in the configuration; only a relay the station lists; sent
   * once, never retried.
   */
  async openDoor(externalId, relay) {
    if (!this.config?.allowDoorOpen) {
      throw new Error(pick(ACTION_TEXT.doorDisabled, this.language));
    }
    const station = this.requireStation(externalId);
    const clean = cleanRelay(relay);
    const listed = station.info.relays;
    const known = listed.length > 0 ? listed.includes(clean) : /^\d$/.test(clean ?? '');
    if (!clean || !known) {
      throw new Error(pick(ACTION_TEXT.unknownRelay, this.language));
    }
    try {
      await station.client.openDoor(clean);
    } catch (err) {
      logger.warn(
        `Scene action: relay ${clean} of ${this.nameOf(station)} not energized: ${err.message}`,
      );
      throw new Error(pick(ERROR_TEXT[err.kind] ?? ERROR_TEXT[ERROR_KINDS.HTTP], this.language), {
        cause: err,
      });
    }
    logger.info(`Scene action: relay ${clean} of ${this.nameOf(station)} energized`);
  }

  // --- Configuration actions -------------------------------------------------------

  /**
   * "Test the connection": read every station again (it also lifts the stop
   * after a refused password), try an image, and report in four languages.
   */
  async testConnection() {
    if (this.stations.size === 0) {
      return this.connectionStatus().message;
    }
    // One more try of a refused password, asked by the user: its event
    // stream follows only if the read succeeds (readSucceeded).
    for (const station of this.stations.values()) {
      station.client.unblock();
    }
    await this.refresh();
    const lines = [];
    for (const station of this.stations.values()) {
      let imageOk = null;
      if (station.read.ok) {
        station.image = null; // a real try, not the last image
        imageOk = Boolean(await this.cameraImage(station));
      }
      lines.push({ station, imageOk, imageError: station.imageError });
    }
    const ok = lines.filter(({ station }) => station.read.ok).length;
    logger.info(`Connection test: ${ok} of ${lines.length} DoorBird(s) answered`);
    return localized((language) =>
      lines
        .map(({ station, imageOk, imageError }) => {
          const text = REPORT_TEXT[language];
          if (!station.read.ok || !station.info) {
            return text.failed(
              station.label,
              pick(ERROR_TEXT[station.read.error?.kind] ?? ERROR_TEXT[ERROR_KINDS.HTTP], language),
            );
          }
          const info = station.info;
          const relays =
            info.relays.length > 0 ? info.relays.join(', ') : pick(ACTION_TEXT.noRelay, language);
          const image =
            imageOk || imageError?.kind === ERROR_KINDS.FORBIDDEN
              ? text.image(imageOk)
              : pick(ERROR_TEXT[imageError?.kind] ?? ACTION_TEXT.snapshotFailed, language);
          return `${text.ok(station.label, info.model ?? 'DoorBird', info.firmware ?? '?', relays)} ${image}`;
        })
        .join(' '),
    );
  }

  /**
   * "Video stream address": the RTSP address of a station, for the "RTSP
   * camera" integration of Gladys, with the user name and a PASSWORD
   * placeholder: the password is never shown nor logged.
   */
  streamUrl(externalId) {
    const station = this.requireStation(externalId);
    const host = new URL(station.origin).hostname;
    const user = encodeURIComponent(station.host.username);
    const rtsp = `rtsp://${user}:PASSWORD@${host}:554/mpeg/media.amp`;
    logger.info(`Configuration action: stream address of ${this.nameOf(station)} shown`);
    return localized((language) => `${pick(ACTION_TEXT.stream, language)} ${rtsp}`);
  }

  // --- Widget ------------------------------------------------------------------------

  /** What the widget shows: the stations and the events. */
  view() {
    return {
      configured: this.stations.size > 0,
      stations: this.known().map((station) => ({
        key: station.key,
        name: this.nameOf(station),
        online: this.isOnline(station),
        externalId: this.idsOf(station).device,
        irLightId: this.idsOf(station).feature(FEATURE_KEYS.IR_LIGHT),
        created: this.isCreated(this.idsOf(station).device),
      })),
      events: this.events,
      eventsToday: (kind, key) => this.eventsToday(kind, key),
      failed: [...this.stations.values()]
        .filter((station) => station.read.ok === false)
        .map((station) => station.read.error),
    };
  }

  /** The raw base64 of an event image of the widget. */
  thumbnail(key) {
    const image = this.thumbnails.get(key);
    if (!image) {
      throw new Error(`Unknown image ${key}`);
    }
    return image;
  }
}

/** A saved identity, checked: what /data holds may be old or damaged. */
function restoreInfo(saved) {
  if (!saved || typeof saved !== 'object' || typeof saved.mac !== 'string' || !saved.mac) {
    return null;
  }
  return {
    mac: saved.mac,
    model: typeof saved.model === 'string' ? saved.model : null,
    firmware: typeof saved.firmware === 'string' ? saved.firmware : null,
    build: typeof saved.build === 'string' ? saved.build : null,
    relays: Array.isArray(saved.relays) ? saved.relays.filter((r) => typeof r === 'string') : [],
  };
}
