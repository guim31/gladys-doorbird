# DoorBird for Gladys Assistant

A [Gladys Assistant](https://gladysassistant.com) integration for **DoorBird**
video door stations (D10x, D11x, D21x, D2101V…) — **locally**, through their
official LAN API. No cloud account, nothing leaves your network.

> **Developed without the hardware: feedback welcome.** No DoorBird was
> available to write this integration: it was built from the public LAN API as
> [DoorBirdPy](https://gitlab.com/klikini/doorbirdpy), Home Assistant,
> Homebridge and openHAB use it, and is covered by tests against a simulated
> door station. Please report what works and what does not in the
> [issues](https://github.com/guim31/gladys-doorbird/issues).

## Features

- **Image** of the camera: refreshed on a timer (every 5 minutes by default),
  at each ring and each motion, and on demand; resized to fit Gladys when
  needed.
- **Doorbell ring**, as the core `doorbell` feature, and **motion** from the
  motion sensor of the DoorBird, received live over its event stream.
- **Online**, and the **infrared light** (on for about 3 minutes, then off by
  itself).
- **Opening the door is disabled by default** and is never a switch: once
  allowed in the configuration, a scene action only energizes a relay the
  DoorBird lists, once, never retried.
- **Scene triggers**: _Someone rang the DoorBird_ and _Motion in front of the
  DoorBird_. The image is refreshed in Gladys before the scene starts, so
  "send the camera image" sends the visitor.
- **Scene actions**: _Refresh the DoorBird image_ and _Open the door (DoorBird
  relay)_ (refused unless allowed).
- **Dashboard widget** _DoorBird_: rings and motions of the last 24 hours with
  their image, the state of each DoorBird, an infrared light button.
- **Configuration actions**: _Test the connection_ (model, firmware, relays,
  image permission) and _Show the video stream address_ (the RTSP address for
  the "RTSP camera" integration of Gladys, never with the password).
- One or two DoorBirds, each with its own user. Four languages: English,
  French, German, Spanish.

## Requirements

- A DoorBird door station reachable from Gladys, with a fixed address.
- A **dedicated DoorBird user** created in the DoorBird App (not the
  administrator), with the "Watch always" permission, and the relays only if
  you will let scenes open the door. The steps are in the user guide.
- Gladys Assistant **5.1.0 or later**.

## Installation

1. In Gladys, open **Integrations** → **Install from GitHub** and enter the
   address of this repository: `https://github.com/guim31/gladys-doorbird` (or
   install **DoorBird** from the catalog once it is listed).
2. In **Configuration**, enter the address of the DoorBird, its user and its
   password, save, then click **Test the connection**.
3. Open the **Discover** tab and add the DoorBird.

The user guide is in [`docs/en.md`](docs/en.md) (also in
[French](docs/fr.md), [German](docs/de.md) and [Spanish](docs/es.md)); Gladys
links it from the Configuration screen.

## How it works

- **API**: `GET /bha-api/…` with HTTP Basic authentication (in a header,
  never in the URL): `info.cgi` (model, firmware, MAC address, relays),
  `image.cgi`, `light-on.cgi`, `open-door.cgi?r=<relay>` and
  `monitor.cgi?ring=doorbell,motionsensor` (events), with node:http/https
  only.
- **Events**: the DoorBird can also call HTTP "favorites" on each event, but
  the Gladys sandbox accepts no incoming connection. The integration keeps an
  outgoing connection to `monitor.cgi` instead — `doorbell:H`,
  `motionsensor:L` lines, the state repeated about every 20 seconds —,
  reopened after a minute of silence, with a growing delay when the station
  is down, recycled every hour. A ring is a change from idle to active: a
  state seen for the first time is not an event. The cloud history
  (`history.cgi`) is not used.
- **Refresh**: devices are published with `should_poll: false`; the container
  reads `info.cgi` every 5 minutes (every minute while the event stream is
  down) — Gladys never polls (GladysAssistant/Gladys#3198).
- **Passwords**: a password refused once (401) is never tried again on its
  own, until the configuration changes or the user tests the connection.
- **States**: `publishChangedStates`, only the changes, plus a heartbeat every
  6 hours; only for the devices added to Gladys.
- **Images**: Gladys takes 150 KB per camera image. A larger image is decoded
  straight at a reduced size by a small baseline JPEG decoder, then encoded
  again with [jpeg-js](https://github.com/eugeneware/jpeg-js), in a worker
  thread (from [gladys-dahua](https://github.com/guim31/gladys-dahua)).
- **Persistence**: `/data/doorbird-state.json` keeps the identity of each
  DoorBird (MAC, model, firmware, relays), so a DoorBird off at start keeps its
  device. Nothing secret.
- **Logs**: the lifecycle only at info level; a repeated failure is logged
  once, and once when it clears; `LOG_LEVEL=debug` shows the rest. Never a
  password.

## What could not be checked

No DoorBird and no Gladys instance were available: the tests run against the
SDK's fake Gladys and a simulated DoorBird built from the answers the
published code and tests show (`test/fixtures/doorbird/`). Not checked for
real:

- the exact framing of the event stream and its repeat every ~20 s (taken
  from Homebridge DoorBird), and whether the current state is sent as soon as
  the stream opens;
- the permission each call needs ("Watch always" for the image and the light,
  the relay for a door; what `monitor.cgi` needs), and the 204 answer when it
  is missing (taken from ioBroker and the LAN API);
- the JSON answer of `light-on.cgi` and `open-door.cgi` (`RETURNCODE`, from
  DoorBirdPy); an empty or non-JSON 200 is accepted;
- the 3 minutes of the infrared light (from Homebridge DoorBird);
- `https://` addresses (self-signed certificates accepted).

A read-only probe is provided for a real DoorBird:
`node scripts/probe.mjs 192.168.1.50` checks that a DoorBird answers (one
anonymous request, which must be refused); with credentials,
`DOORBIRD_PASSWORD=… node scripts/probe.mjs 192.168.1.50 abcdef0001` prints
the model, firmware and relays, takes an image and prints the event stream for
30 seconds, without printing the password or the MAC address. It switches
nothing on, opens nothing.

## Limitations

- RFID badges and keypad codes are not reported: `monitor.cgi` carries only
  the doorbell and the motion sensor; the other events need the favorites
  (an incoming connection).
- No live video (use the RTSP address in the "RTSP camera" integration), no
  two-way audio, no SIP, no cloud history.
- Two DoorBirds at most; the widget's event list is kept in memory.
- The infrared light cannot be switched off on command.

## Development

```bash
npm ci
npm run format:check
npm run lint
npm test
npx -y github:GladysAssistant/integration-store --skip-image-check .
```

The tests use the fake Gladys of the SDK (`@gladysassistant/integration-sdk/testing`)
and a simulated DoorBird (`test/helpers/fakeDoorBird.js`) that checks the
Basic authentication and writes its event stream part by part. See
[`CLAUDE.md`](CLAUDE.md) for the project rules.

### Releasing

Describe each change under `## [Unreleased]` in
[`CHANGELOG.md`](CHANGELOG.md), then **Actions → Release → Run workflow**
(`patch`, `minor` or `major`): the workflow bumps the version everywhere, moves
the changelog section, tags, builds the multi-arch image to `ghcr.io` and
publishes the GitHub Release.

> A hand-pushed tag (`git tag v1.2.3 && git push --tags`) triggers the same
> build and Release, but does **not** bump anything: update `version` in
> `package.json` and in `gladys-assistant-integration.json` (with the
> `docker_image` tag) and commit it before tagging.

## Credits

- [DoorBirdPy](https://gitlab.com/klikini/doorbirdpy) (MIT, Andy Castille),
  the Python library of the LAN API: the endpoints, the shape of `info.cgi`
  (the fixture of its tests, anonymised), the `RETURNCODE` of the commands and
  the reading of `monitor.cgi`.
- The Home Assistant [`doorbird`](https://www.home-assistant.io/integrations/doorbird)
  integration (Apache-2.0): the identity by MAC address (wired first), the
  relays of paired door controllers, its `info.cgi` test fixture.
- [Homebridge DoorBird](https://github.com/brownad/homebridge-doorbird)
  (Apache-2.0, HJD): the framing of the event stream, its ~20 s repeat, the 3
  minutes of the infrared light.
- [ioBroker.doorbird](https://github.com/iobroker-community-adapters/ioBroker.doorbird)
  (MIT): the 204 answer of a missing permission. The openHAB DoorBird binding
  was read (not copied) for the wired and Wi-Fi MAC addresses.
- No code was copied; the protocol knowledge was rewritten in JavaScript.
  [jpeg-js](https://github.com/eugeneware/jpeg-js) (BSD-3-Clause) encodes the
  resized images.
- The architecture, the image pipeline, the conformity tests and the quiet
  logs follow [gladys-dahua](https://github.com/guim31/gladys-dahua),
  [gladys-pihole](https://github.com/guim31/gladys-pihole) and
  [gladys-wled](https://github.com/guim31/gladys-wled).

## Disclaimer

This project is not affiliated with, endorsed or sponsored by Bird Home
Automation GmbH. DoorBird is a trademark of its owner.

## License

Apache-2.0 — see [`LICENSE`](LICENSE).
