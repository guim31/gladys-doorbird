// -----------------------------------------------------------------------------
// Scene action handlers (manifest `scene_actions`, Gladys 5.1+).
//
//   - refresh_image: a fresh image of a DoorBird, sent to Gladys, so the next
//     action ("send the camera image" in a message) sends what it sees now;
//   - open_door: energize a relay of a DoorBird (door strike, gate). Disabled
//     by default: it only works once allowed in the configuration, it is never
//     a switch of a device (no voice assistant, no dashboard toggle can open
//     it by mistake), only a relay the DoorBird lists, and the command is sent
//     once, never retried.
// Gladys applies the field defaults to scene actions; a failure throws, the
// scene logs it and carries on.
// -----------------------------------------------------------------------------

export const DEFAULT_RELAY = '1';

export const SCENE_ACTIONS = {
  async refresh_image(hub, { fields = {} }) {
    await hub.refreshImage(fields.doorbird);
  },

  async open_door(hub, { fields = {} }) {
    const relay = String(fields.relay ?? '').trim() || DEFAULT_RELAY;
    await hub.openDoor(fields.doorbird, relay);
  },
};
