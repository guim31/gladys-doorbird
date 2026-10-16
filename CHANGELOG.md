# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- DoorBird video door stations (D10x, D11x, D21x, D2101V…) over their local
  LAN API, one or two of them, each with its own DoorBird user: one Gladys
  device per DoorBird, keyed by its MAC address.
- Camera image, refreshed on a timer (every 5 minutes by default), at each
  ring and motion, and on demand; resized to fit Gladys.
- Doorbell ring, motion and online, followed live over the event stream of the
  DoorBird (`monitor.cgi`), with no incoming connection.
- Infrared light, switched on from Gladys (it goes off by itself after about 3
  minutes).
- Scene triggers "Someone rang the DoorBird" and "Motion in front of the
  DoorBird", with a fresh image before the scene starts.
- Scene actions "Refresh the DoorBird image" and "Open the door (DoorBird
  relay)": disabled by default, never a switch, only a relay the DoorBird
  lists, sent once.
- Dashboard widget "DoorBird": rings and motions of the last 24 hours with
  their image, the state of each DoorBird, an infrared light button.
- Configuration actions "Test the connection" (model, firmware, relays, image
  permission) and "Show the video stream address" (for the "RTSP camera"
  integration, never with the password).
- A password refused once is never tried again on its own.
- English, French, German and Spanish.

[Unreleased]: https://github.com/guim31/gladys-doorbird/commits/main
