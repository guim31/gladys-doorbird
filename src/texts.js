// -----------------------------------------------------------------------------
// Texts the integration sends to Gladys outside the widget (src/widgets.js):
// connection status, errors, the reports of the Configuration actions, scene
// action and command errors. Four languages, the four of the Gladys
// interface; German says "du", Spanish "usted". test/i18n.test.js checks
// every table.
// -----------------------------------------------------------------------------

import { ERROR_KINDS } from './doorbird/client.js';

export const LANGUAGE_FALLBACK = 'en';

export const pick = (text, language) => text[language] ?? text[LANGUAGE_FALLBACK];

/** A multi-language object built by a function of the language. */
export const localized = (render) =>
  Object.fromEntries(['en', 'fr', 'de', 'es'].map((language) => [language, render(language)]));

export const INIT_FAILED = {
  en: 'Initialization failed, check the integration logs.',
  fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
  de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
  es: 'La inicialización ha fallado, consulte los registros de la integración.',
};

export const CONNECTION_TEXT = {
  noHost: {
    en: 'Enter the address, user and password of your DoorBird in the configuration.',
    fr: "Saisissez l'adresse, l'utilisateur et le mot de passe de votre DoorBird dans la configuration.",
    de: 'Gib Adresse, Benutzer und Passwort deines DoorBird in der Konfiguration ein.',
    es: 'Introduzca la dirección, el usuario y la contraseña de su DoorBird en la configuración.',
  },
  invalidHost: {
    en: 'Address not understood, e.g. 192.168.1.50 (no password in the address).',
    fr: "Adresse incomprise, ex. 192.168.1.50 (pas de mot de passe dans l'adresse).",
    de: 'Adresse nicht verstanden, z. B. 192.168.1.50 (kein Passwort in der Adresse).',
    es: 'Dirección no válida, p. ej. 192.168.1.50 (sin contraseña en la dirección).',
  },
  incomplete: {
    en: 'Enter the user name and the password of each DoorBird in the configuration.',
    fr: "Saisissez le nom d'utilisateur et le mot de passe de chaque DoorBird dans la configuration.",
    de: 'Gib den Benutzernamen und das Passwort jedes DoorBird in der Konfiguration ein.',
    es: 'Introduzca el nombre de usuario y la contraseña de cada DoorBird en la configuración.',
  },
  someDown: {
    en: 'Connected, but a DoorBird does not answer: see the integration logs.',
    fr: "Connectée, mais un DoorBird ne répond pas : voir les logs de l'intégration.",
    de: 'Verbunden, aber ein DoorBird antwortet nicht: Sieh dir die Protokolle der Integration an.',
    es: 'Conectada, pero un DoorBird no responde: consulte los registros de la integración.',
  },
  live: {
    en: 'Connected, but rings and motions are not received live: the integration retries.',
    fr: "Connectée, mais sonneries et mouvements n'arrivent plus en direct : l'intégration réessaie.",
    de: 'Verbunden, aber Klingeln und Bewegungen kommen nicht live an: Die Integration versucht es erneut.',
    es: 'Conectada, pero los timbres y movimientos no llegan en directo: la integración lo reintenta.',
  },
};

// One explanation per error kind (src/doorbird/client.js), shown in the
// connection status, the reports and the failed commands.
export const ERROR_TEXT = {
  [ERROR_KINDS.UNREACHABLE]: {
    en: 'The DoorBird does not answer: check its address and that Gladys can reach it.',
    fr: "Le DoorBird ne répond pas : vérifiez son adresse et que Gladys peut l'atteindre.",
    de: 'Der DoorBird antwortet nicht: Prüfe seine Adresse und ob Gladys ihn erreicht.',
    es: 'El DoorBird no responde: compruebe su dirección y que Gladys pueda alcanzarlo.',
  },
  [ERROR_KINDS.AUTH]: {
    en: 'User name or password refused by the DoorBird: check them in the configuration.',
    fr: "Nom d'utilisateur ou mot de passe refusé par le DoorBird : vérifiez-les dans la configuration.",
    de: 'Benutzername oder Passwort vom DoorBird abgelehnt: Prüfe sie in der Konfiguration.',
    es: 'Nombre de usuario o contraseña rechazados por el DoorBird: compruébelos en la configuración.',
  },
  [ERROR_KINDS.BLOCKED]: {
    en: 'Password refused: the integration stopped asking. Fix it, then test the connection.',
    fr: "Mot de passe refusé : l'intégration ne réessaie plus. Corrigez-le, puis testez la connexion.",
    de: 'Passwort abgelehnt: Die Integration fragt nicht mehr. Korrigiere es und teste die Verbindung.',
    es: 'Contraseña rechazada: la integración ya no lo intenta. Corríjala y pruebe la conexión.',
  },
  [ERROR_KINDS.FORBIDDEN]: {
    en: 'This DoorBird user lacks the permission: give it in the DoorBird App (see the documentation).',
    fr: "Cet utilisateur DoorBird n'a pas ce droit : donnez-le dans l'app DoorBird (voir la documentation).",
    de: 'Diesem DoorBird-Benutzer fehlt das Recht: Gib es in der DoorBird-App (siehe Dokumentation).',
    es: 'Este usuario DoorBird no tiene ese permiso: concédalo en la app DoorBird (vea la documentación).',
  },
  [ERROR_KINDS.NOT_DOORBIRD]: {
    en: 'No DoorBird LAN API at this address: check the address.',
    fr: "Pas d'API LAN DoorBird à cette adresse : vérifiez l'adresse.",
    de: 'Keine DoorBird-LAN-API unter dieser Adresse: Prüfe die Adresse.',
    es: 'No hay API LAN de DoorBird en esta dirección: compruebe la dirección.',
  },
  [ERROR_KINDS.REFUSED]: {
    en: 'The DoorBird refused the command.',
    fr: 'Le DoorBird a refusé la commande.',
    de: 'Der DoorBird hat den Befehl abgelehnt.',
    es: 'El DoorBird rechazó la orden.',
  },
  [ERROR_KINDS.HTTP]: {
    en: 'The DoorBird refused the request: see the integration logs.',
    fr: "Le DoorBird a refusé la requête : voir les logs de l'intégration.",
    de: 'Der DoorBird hat die Anfrage abgelehnt: Sieh dir die Protokolle der Integration an.',
    es: 'El DoorBird rechazó la solicitud: consulte los registros de la integración.',
  },
};

// Report of the "Test the connection" action, one line per DoorBird.
export const REPORT_TEXT = {
  en: {
    ok: (host, model, firmware, relays) =>
      `${host}: ${model}, firmware ${firmware}, relays ${relays}.`,
    image: (ok) => (ok ? 'Image: OK.' : 'Image: refused, give "Watch always" to this user.'),
    failed: (host, reason) => `${host}: ${reason}`,
  },
  fr: {
    ok: (host, model, firmware, relays) =>
      `${host} : ${model}, firmware ${firmware}, relais ${relays}.`,
    image: (ok) =>
      ok ? 'Image : OK.' : 'Image : refusée, donnez « Watch always » à cet utilisateur.',
    failed: (host, reason) => `${host} : ${reason}`,
  },
  de: {
    ok: (host, model, firmware, relays) =>
      `${host}: ${model}, Firmware ${firmware}, Relais ${relays}.`,
    image: (ok) => (ok ? 'Bild: OK.' : 'Bild: abgelehnt, gib diesem Benutzer „Watch always“.'),
    failed: (host, reason) => `${host}: ${reason}`,
  },
  es: {
    ok: (host, model, firmware, relays) =>
      `${host}: ${model}, firmware ${firmware}, relés ${relays}.`,
    image: (ok) =>
      ok ? 'Imagen: OK.' : 'Imagen: rechazada, conceda «Watch always» a este usuario.',
    failed: (host, reason) => `${host}: ${reason}`,
  },
};

// Messages of the Configuration actions, of the commands and errors of the
// scene actions.
export const ACTION_TEXT = {
  notConfigured: {
    en: 'Configure the address, user name and password of a DoorBird first.',
    fr: "Configurez d'abord l'adresse, le nom d'utilisateur et le mot de passe d'un DoorBird.",
    de: 'Konfiguriere zuerst Adresse, Benutzername und Passwort eines DoorBird.',
    es: 'Configure primero la dirección, el nombre de usuario y la contraseña de un DoorBird.',
  },
  pickDoorBird: {
    en: 'Choose a DoorBird added to Gladys.',
    fr: 'Choisissez un DoorBird ajouté à Gladys.',
    de: 'Wähle einen DoorBird, der zu Gladys hinzugefügt wurde.',
    es: 'Elija un DoorBird añadido a Gladys.',
  },
  unknownDoorBird: {
    en: 'This device is not (or no longer) one of the configured DoorBirds.',
    fr: "Cet appareil n'est pas (ou plus) un des DoorBird configurés.",
    de: 'Dieses Gerät gehört nicht (mehr) zu den konfigurierten DoorBirds.',
    es: 'Este dispositivo no es (o ya no es) uno de los DoorBird configurados.',
  },
  doorDisabled: {
    en: 'Opening the door is disabled: allow it in the configuration of the integration first.',
    fr: "L'ouverture de porte est désactivée : autorisez-la d'abord dans la configuration de l'intégration.",
    de: 'Das Öffnen der Tür ist deaktiviert: Erlaube es zuerst in der Konfiguration der Integration.',
    es: 'La apertura de la puerta está desactivada: autorícela primero en la configuración de la integración.',
  },
  unknownRelay: {
    en: 'This DoorBird has no such relay: see the relays listed by "Test the connection".',
    fr: "Ce DoorBird n'a pas ce relais : voyez les relais listés par « Tester la connexion ».",
    de: 'Dieser DoorBird hat dieses Relais nicht: Sieh dir die Relais unter „Verbindung testen“ an.',
    es: 'Este DoorBird no tiene ese relé: vea los relés listados por «Probar la conexión».',
  },
  irOff: {
    en: 'The infrared light cannot be switched off: it goes off by itself after about 3 minutes.',
    fr: "L'éclairage infrarouge ne s'éteint pas sur commande : il s'éteint seul après 3 minutes environ.",
    de: 'Das Infrarotlicht lässt sich nicht ausschalten: Es geht nach etwa 3 Minuten von selbst aus.',
    es: 'La luz infrarroja no se puede apagar: se apaga sola tras unos 3 minutos.',
  },
  snapshotFailed: {
    en: 'The DoorBird did not send an image.',
    fr: "Le DoorBird n'a pas envoyé d'image.",
    de: 'Der DoorBird hat kein Bild gesendet.',
    es: 'El DoorBird no envió ninguna imagen.',
  },
  stream: {
    en: 'For the "RTSP camera" integration of Gladys (replace PASSWORD):',
    fr: "Pour l'intégration « Caméra RTSP » de Gladys (remplacez PASSWORD) :",
    de: 'Für die Integration „RTSP-Kamera“ von Gladys (ersetze PASSWORD):',
    es: 'Para la integración «Cámara RTSP» de Gladys (sustituya PASSWORD):',
  },
  noRelay: {
    en: 'none listed',
    fr: 'aucun listé',
    de: 'keine gelistet',
    es: 'ninguno listado',
  },
};
