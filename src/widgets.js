// -----------------------------------------------------------------------------
// Dashboard widget (manifest `widgets`, Gladys 5.1+): `doorbird`.
//
// The use case: a glance at the wall tablet — "who rang, who came by the
// door?". So the widget shows:
//   - two tiles: rings and motions over 24 hours;
//   - the last rings and motions, newest first, each with the image taken
//     when it happened (card-list, list display, its date under the title);
//   - the state of the DoorBirds (online or not);
//   - a button that switches the infrared light on, when one DoorBird is
//     shown and added to Gladys (a `device_feature` button: Gladys sends the
//     command through onSetValue). Never a door button: opening a door is a
//     scene action only.
// Every DoorBird by default, or the one chosen in the widget settings.
//
// Budget (8 components, ≤ 2 texts, one focal component, one status): two
// tiles, one card-list, one status, one button, one caption. The events are
// kept in memory: the list starts empty after a restart. Images: keys
// `ev-<id>`, immutable, served by onWidgetGetImage from the hub.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { EVENT_KINDS, WIDGET_KEY } from './hub.js';
import { ERROR_KINDS } from './doorbird/client.js';
import { ERROR_TEXT, pick } from './texts.js';

export const TEXT = {
  configure: {
    en: 'Enter the address, user and password of your DoorBird in the configuration of the integration.',
    fr: "Saisissez l'adresse, l'utilisateur et le mot de passe de votre DoorBird dans la configuration de l'intégration.",
    de: 'Gib Adresse, Benutzer und Passwort deines DoorBird in der Konfiguration der Integration ein.',
    es: 'Introduzca la dirección, el usuario y la contraseña de su DoorBird en la configuración de la integración.',
  },
  unknown: {
    en: 'This DoorBird is no longer configured: choose another one in the widget settings.',
    fr: "Ce DoorBird n'est plus configuré : choisissez-en un autre dans les réglages du widget.",
    de: 'Dieser DoorBird ist nicht mehr konfiguriert: Wähle einen anderen in den Widget-Einstellungen.',
    es: 'Este DoorBird ya no está configurado: elija otro en la configuración del widget.',
  },
  noEvent: {
    en: 'No ring and no motion since the integration started.',
    fr: "Ni sonnerie ni mouvement depuis le démarrage de l'intégration.",
    de: 'Kein Klingeln und keine Bewegung seit dem Start der Integration.',
    es: 'Ningún timbre ni movimiento desde el inicio de la integración.',
  },
  rings: { en: 'Rings 24 h', fr: 'Sonneries 24 h', de: 'Klingeln 24 h', es: 'Timbres 24 h' },
  motions: {
    en: 'Motions 24 h',
    fr: 'Mouvements 24 h',
    de: 'Bewegungen 24 h',
    es: 'Movimientos 24 h',
  },
  isOnline: { en: 'Online', fr: 'En ligne', de: 'Online', es: 'En línea' },
  isOffline: { en: 'Offline', fr: 'Hors ligne', de: 'Offline', es: 'Sin conexión' },
  ring: { en: 'Ring', fr: 'Sonnerie', de: 'Klingeln', es: 'Timbre' },
  motion: { en: 'Motion', fr: 'Mouvement', de: 'Bewegung', es: 'Movimiento' },
  irLight: {
    en: 'Infrared light',
    fr: 'Éclairage infrarouge',
    de: 'Infrarotlicht',
    es: 'Luz infrarroja',
  },
};

const t = (text, language) => pick(text, language);
const fit = (text, max) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

function message(text, language) {
  return {
    ttl_seconds: 300,
    components: [{ type: 'text', variant: 'body', text: t(text, language) }],
  };
}

/** "Ring · DoorBird D2101V" — what happened, and where. */
export function eventTitle(event, stationName, language) {
  const what = t(event.kind === EVENT_KINDS.RING ? TEXT.ring : TEXT.motion, language);
  return fit(`${what} · ${stationName}`, 60);
}

async function get(hub, { settings, language = 'en' }) {
  const view = hub.view();
  if (!view.configured) {
    return message(TEXT.configure, language);
  }
  let shown = view.stations;
  if (settings?.doorbird) {
    const station = view.stations.find((entry) => entry.externalId === settings.doorbird);
    if (!station) {
      return message(TEXT.unknown, language);
    }
    shown = [station];
  }
  const components = [];
  if (view.failed.length > 0) {
    const error = view.failed[0];
    components.push({
      type: 'text',
      variant: 'caption',
      text: fit(t(ERROR_TEXT[error?.kind] ?? ERROR_TEXT[ERROR_KINDS.HTTP], language), 80),
    });
  }

  const key = settings?.doorbird ? shown[0].key : null;
  components.push(
    {
      type: 'value',
      value: view.eventsToday(EVENT_KINDS.RING, key),
      label: t(TEXT.rings, language),
      icon: 'bell',
    },
    {
      type: 'value',
      value: view.eventsToday(EVENT_KINDS.MOTION, key),
      label: t(TEXT.motions, language),
      icon: 'eye',
    },
  );

  const byKey = new Map(view.stations.map((station) => [station.key, station]));
  const events = view.events
    .filter((event) => !key || event.key === key)
    .filter((event) => byKey.has(event.key));
  if (events.length > 0) {
    components.push({
      type: 'card-list',
      display: 'list',
      items: events.slice(0, 8).map((event) => ({
        title: eventTitle(event, byKey.get(event.key).name, language),
        date: new Date(event.at).toISOString(),
        ...(event.imageKey ? { image: event.imageKey } : {}),
      })),
    });
  } else if (view.failed.length === 0) {
    components.push({ type: 'text', variant: 'caption', text: t(TEXT.noEvent, language) });
  }

  const items = shown.slice(0, 10).map((station) => ({
    label: fit(station.name, 40),
    icon: station.online ? 'video' : 'video-off',
    value: t(station.online ? TEXT.isOnline : TEXT.isOffline, language),
    color: station.online ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.DANGER,
  }));
  if (items.length > 0) {
    components.push({ type: 'status', items });
  }

  // The light of a DoorBird added to Gladys: the core needs the feature.
  if (shown.length === 1 && shown[0].created && shown[0].online) {
    components.push({
      type: 'button',
      label: t(TEXT.irLight, language),
      icon: 'sun',
      style: 'secondary',
      device_feature: shown[0].irLightId,
      value: 1,
    });
  }
  // Rings and motions nudge the widget (requestWidgetRefresh); the TTL is a net.
  return { ttl_seconds: 120, components };
}

export const WIDGETS = {
  [WIDGET_KEY]: { get },
};
