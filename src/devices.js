// -----------------------------------------------------------------------------
// The Gladys device of a door station: one per DoorBird.
//
// Identity: the MAC address the station reports (info.cgi, the wired one
// first, as Home Assistant does), never an address or a name:
// `gladys.externalIds('doorbird', mac)`. Feature keys are permanent once
// published (test/gladys-rules.test.js checks the couples against the core
// table).
//
// Features:
//   image     camera/image          the camera picture
//   online    input/binary          the station answers (shown On/Off)
//   ring      doorbell/ring         1 → 0 pulse at each ring, as the core expects
//   motion    motion-sensor/binary  the motion sensor, 1 while it reports motion
//   ir_light  light/binary          the infrared light: on for about 3 minutes,
//                                   then off by itself (no "off" command exists)
// The door relays are NEVER a feature: no switch, no voice assistant, no
// dashboard toggle can open a door. Opening exists only as a scene action,
// disabled until allowed in the configuration (src/scenes.js).
// "Online" is input/binary: presence-sensor/binary would read "Presence
// detected" on a door station.
//
// The devices are published with should_poll: false: the integration follows
// the event stream and reads the stations on its own timer (src/hub.js),
// never waiting for Gladys to poll (GladysAssistant/Gladys#3198).
// -----------------------------------------------------------------------------

import { DEVICE_FEATURE_CATEGORIES, DEVICE_FEATURE_TYPES } from '@gladysassistant/integration-sdk';

export const DEVICE_TYPE = 'doorbird';

// Suffixes of the feature external ids: permanent once published.
export const FEATURE_KEYS = Object.freeze({
  IMAGE: 'image',
  ONLINE: 'online',
  RING: 'ring',
  MOTION: 'motion',
  IR_LIGHT: 'ir_light',
});

// Feature names, in the language chosen in the configuration (Gladys does not
// tell a device integration the user's language). Frozen at creation in Gladys.
export const NAMES = {
  en: {
    image: 'Image',
    online: 'Online',
    ring: 'Doorbell ring',
    motion: 'Motion',
    ir_light: 'Infrared light',
  },
  fr: {
    image: 'Image',
    online: 'En ligne',
    ring: 'Sonnette',
    motion: 'Mouvement',
    ir_light: 'Éclairage infrarouge',
  },
  de: {
    image: 'Bild',
    online: 'Online',
    ring: 'Türklingel',
    motion: 'Bewegung',
    ir_light: 'Infrarotlicht',
  },
  es: {
    image: 'Imagen',
    online: 'En línea',
    ring: 'Timbre',
    motion: 'Movimiento',
    ir_light: 'Luz infrarroja',
  },
};

const sensor = (category, type) => ({
  category,
  type,
  read_only: true,
  has_feedback: false,
  keep_history: true,
  min: 0,
  max: 1,
});

const DEFINITIONS = {
  [FEATURE_KEYS.IMAGE]: {
    category: DEVICE_FEATURE_CATEGORIES.CAMERA,
    type: DEVICE_FEATURE_TYPES.CAMERA.IMAGE,
    read_only: true,
    has_feedback: false,
    // Images travel on their own channel, never in the states history.
    keep_history: false,
    min: 0,
    max: 0,
  },
  [FEATURE_KEYS.ONLINE]: sensor(
    DEVICE_FEATURE_CATEGORIES.INPUT,
    DEVICE_FEATURE_TYPES.SENSOR.BINARY,
  ),
  [FEATURE_KEYS.RING]: sensor(
    DEVICE_FEATURE_CATEGORIES.DOORBELL,
    DEVICE_FEATURE_TYPES.DOORBELL.RING,
  ),
  [FEATURE_KEYS.MOTION]: sensor(
    DEVICE_FEATURE_CATEGORIES.MOTION_SENSOR,
    DEVICE_FEATURE_TYPES.SENSOR.BINARY,
  ),
  [FEATURE_KEYS.IR_LIGHT]: {
    category: DEVICE_FEATURE_CATEGORIES.LIGHT,
    type: DEVICE_FEATURE_TYPES.LIGHT.BINARY,
    read_only: false,
    // The station cannot say whether its light is on: the integration
    // publishes 1 at the command and 0 once the light went off by itself.
    has_feedback: false,
    keep_history: true,
    min: 0,
    max: 1,
  },
};

export const FEATURE_ORDER = Object.freeze([
  FEATURE_KEYS.IMAGE,
  FEATURE_KEYS.ONLINE,
  FEATURE_KEYS.RING,
  FEATURE_KEYS.MOTION,
  FEATURE_KEYS.IR_LIGHT,
]);

/** External ids of a station and its features. */
export const stationIds = (gladys, station) => gladys.externalIds(DEVICE_TYPE, station.mac);

/**
 * The name shown for a station: its model ("DoorBird D2101V"), with the end
 * of its MAC address when two stations share the model.
 * @param {object} station { mac, model }
 * @param {object[]} [all] every station, to tell twins apart
 */
export function stationName(station, all = []) {
  const model = station.model?.trim() || 'DoorBird';
  const base = /doorbird/i.test(model) ? model : `DoorBird ${model}`;
  const twins = all.filter((other) => other.mac !== station.mac && other.model === station.model);
  return twins.length > 0 ? `${base} ${station.mac.slice(-4)}` : base;
}

/**
 * The discovery payload of a station.
 * @param {object} gladys SDK client
 * @param {object} station { mac, model, firmware, host }
 * @param {object} [options] { language, all }
 */
export function buildDevice(gladys, station, { language = 'en', all = [] } = {}) {
  const ids = stationIds(gladys, station);
  const names = NAMES[language] ?? NAMES.en;
  return {
    name: stationName(station, all),
    external_id: ids.device,
    ...(station.model ? { model: station.model } : {}),
    should_poll: false,
    params: [{ name: 'host', value: station.host }],
    features: FEATURE_ORDER.map((key) => ({
      ...DEFINITIONS[key],
      name: names[key],
      external_id: ids.feature(key),
    })),
  };
}

const flag = (value) => (value ? 1 : 0);

/**
 * The value of every feature of a station (the image aside).
 * @param {object} live { online, ring, motion, irLight }
 */
export function featureValues(live) {
  return {
    [FEATURE_KEYS.ONLINE]: flag(live.online),
    [FEATURE_KEYS.RING]: flag(live.ring),
    [FEATURE_KEYS.MOTION]: flag(live.motion),
    [FEATURE_KEYS.IR_LIGHT]: flag(live.irLight),
  };
}
