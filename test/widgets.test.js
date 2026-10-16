// -----------------------------------------------------------------------------
// The `doorbird` widget: within the core budget and vocabulary
// (validateWidgetContent), its images served, a DoorBird chosen in its
// settings with its infrared light button, its references to real features,
// and its messages when nothing is configured or a DoorBird is gone.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { WIDGET_KEY } from '../src/hub.js';
import { createAll, createWorld, ids, settle } from './helpers/world.js';

async function world(t, options) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  return w;
}

async function content(w, settings = {}, language = 'en') {
  const ack = await w.fake.widgetGet(WIDGET_KEY, { settings, language, units: 'metric' });
  assert.equal(ack.success, true, ack.error);
  return ack.data.content;
}

test('every DoorBird, the rings and motions with their images, within the budget', async (t) => {
  const w = await world(t);
  await createAll(w);
  w.clock.advance(60_000);
  await w.motion('gate');
  w.clock.advance(60_000);
  await w.ring('front');
  const widget = await content(w);
  assert.deepEqual(validateWidgetContent(widget), []);
  const [rings, motions, list, status] = widget.components;
  assert.equal(rings.value, 1);
  assert.equal(motions.value, 1);
  assert.deepEqual(
    list.items.map((item) => item.title),
    ['Ring · DoorBird D2101V', 'Motion · DoorBird D101'],
  );
  assert.ok(list.items.every((item) => item.image && item.date));
  assert.equal(status.items.length, 2);
  // No light button for two DoorBirds at once.
  assert.ok(!widget.components.some((component) => component.type === 'button'));
  // The image of a list item is served.
  const image = await w.fake.widgetGetImage(list.items[0].image);
  assert.equal(image.success, true);
  assert.ok(Buffer.from(image.data.image, 'base64').length > 100);
  // The widget was nudged by the events.
  assert.ok(w.fake.widgetRefreshes.length > 0);
});

test('one DoorBird chosen in the settings: its events, and its infrared light button', async (t) => {
  const w = await world(t);
  await createAll(w);
  w.clock.advance(60_000);
  await w.motion('gate');
  await w.ring('front');
  const front = ids(w.gladys, 'front');
  const widget = await content(w, { doorbird: front.device }, 'fr');
  assert.deepEqual(validateWidgetContent(widget), []);
  assert.equal(widget.components[0].value, 1);
  assert.equal(widget.components[1].value, 0);
  assert.deepEqual(
    widget.components[2].items.map((item) => item.title),
    ['Sonnerie · DoorBird D2101V'],
  );
  const button = widget.components.find((component) => component.type === 'button');
  assert.equal(button.device_feature, front.feature('ir_light'));
  assert.equal(button.value, 1);
  // The button names a feature the device really has.
  const device = w.fake.discoveredDevices.find((d) => d.external_id === front.device);
  assert.ok(device.features.some((feature) => feature.external_id === button.device_feature));
  // Pressed: Gladys sends it to onSetValue.
  const light = device.features.find((feature) => feature.external_id === button.device_feature);
  assert.equal((await w.fake.setValue(device, light, button.value)).success, true);
  assert.equal(w.stations.front.lights, 1);
});

test('no light button for a DoorBird not added to Gladys', async (t) => {
  const w = await world(t);
  const widget = await content(w, { doorbird: ids(w.gladys, 'front').device });
  assert.ok(!widget.components.some((component) => component.type === 'button'));
});

test('an offline DoorBird shows in the status and a caption', async (t) => {
  const w = await world(t);
  w.stations.gate.online = false;
  w.stations.gate.dropStreams();
  await settle();
  await w.hub.refresh();
  const widget = await content(w);
  assert.deepEqual(validateWidgetContent(widget), []);
  assert.equal(widget.components[0].type, 'text');
  assert.match(widget.components[0].text, /does not answer/);
  const status = widget.components.find((component) => component.type === 'status');
  assert.deepEqual(
    status.items.map((item) => item.value),
    ['Online', 'Offline'],
  );
});

test('messages: nothing configured, a DoorBird gone, nothing seen yet', async (t) => {
  const empty = await world(t, { config: {} });
  assert.match((await content(empty)).components[0].text, /Enter the address/);
  const w = await world(t);
  const gone = await content(w, { doorbird: 'ext:test-integration:doorbird:GONE' }, 'de');
  assert.match(gone.components[0].text, /nicht mehr konfiguriert/);
  const quiet = await content(w, { doorbird: ids(w.gladys, 'gate').device }, 'es');
  assert.deepEqual(validateWidgetContent(quiet), []);
  assert.ok(quiet.components.some((c) => c.type === 'text' && /Ningún timbre/.test(c.text)));
});

test('the widget stays within the budget in every language, events piling up', async (t) => {
  const w = await world(t);
  await createAll(w);
  for (let i = 0; i < 12; i += 1) {
    w.clock.advance(30_000);
    await w.ring('front');
    await w.motion('gate');
    await w.motion('gate', false);
  }
  for (const language of ['en', 'fr', 'de', 'es']) {
    const all = await content(w, {}, language);
    assert.deepEqual(validateWidgetContent(all), [], language);
    const one = await content(w, { doorbird: ids(w.gladys, 'front').device }, language);
    assert.deepEqual(validateWidgetContent(one), [], language);
    assert.ok(one.components.length <= 8);
  }
});
