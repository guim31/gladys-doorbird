# DoorBird fixtures

Answers of the DoorBird LAN API, in the shapes the published code and tests
show. No DoorBird was available to this repository: run `scripts/probe.mjs`
on a real station to confirm them.

- `info-d2101v.json`: `info.cgi` of a D2101V on Wi-Fi with two relays and a
  paired I/O door controller (`<id>@<n>` relays). Shape of the fixture of the
  Home Assistant `doorbird` tests and of `klikini/doorbirdpy`
  (`tests/info.json`).
- `info-d101-wired.json`: a wired D101 (`PRIMARY_MAC_ADDR` and
  `WIFI_MAC_ADDR`), as the openHAB DoorBird binding tests describe it.
- `info-old-firmware.json`: a firmware older than 000108, which lists neither
  `RELAYS` nor `DEVICE-TYPE` (DoorBirdPy documents both from 000108 on).
- `command-ok.json`: the JSON of a successful command (`light-on.cgi`,
  `open-door.cgi`), read through `RETURNCODE` by DoorBirdPy.

The event stream (`monitor.cgi?ring=doorbell,motionsensor`) is written by
`test/helpers/fakeDoorBird.js`: `multipart/x-mixed-replace;
boundary=--ioboundary`, parts of `text/plain` lines `doorbell:H` /
`motionsensor:L`, the current state repeated about every 20 seconds (as
Homebridge DoorBird and DoorBirdPy read it).

Anonymized: MAC addresses invented on the DoorBird prefix `1CCAE3`, relay
controller ids invented, addresses in 192.0.2.0/24 (documentation range).
