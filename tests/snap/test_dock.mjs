// SNAP-R285/R70: the right dock's tab rule and the Room's layout preference, from web/snap/dock.mjs; no page or server.
import test from 'node:test';
import assert from 'node:assert/strict';
import { dockTab, readLayout, mergeLayout, DOCK_MIN_W, DOCK_OPEN_W, DOCK_MIN_HOST } from '../../web/snap/dock.mjs';

test('nothing to show closes the column', () => {
  assert.equal(dockTab({}), null);
  assert.equal(dockTab({ selected: false, roomOpen: false, last: 'conversation', cause: 'room-close' }), null);
  assert.equal(dockTab({ selected: false, roomOpen: false, last: 'inspector', cause: 'deselect' }), null);
});
test('opening the Room shows the Conversation, a selection or not', () => {
  assert.equal(dockTab({ roomOpen: true, cause: 'room-open' }), 'conversation');
  assert.equal(dockTab({ selected: true, roomOpen: true, last: 'inspector', cause: 'room-open' }), 'conversation');
  assert.equal(dockTab({ selected: true, roomOpen: true, last: 'inspector', cause: 'room-show' }), 'conversation');
});
test('selecting a brick shows the Inspector unless the Conversation is pinned', () => {
  assert.equal(dockTab({ selected: true, roomOpen: true, last: 'conversation', cause: 'select' }), 'inspector');
  assert.equal(dockTab({ selected: true, roomOpen: true, pinned: true, last: 'conversation', cause: 'select' }), 'conversation');
  assert.equal(dockTab({ selected: true, roomOpen: false, pinned: true, cause: 'select' }), 'inspector'); // no Room: the pin has nothing to keep
});
test('deselecting with the Room open shows the Conversation; closing the Room with a selection shows the Inspector', () => {
  assert.equal(dockTab({ selected: false, roomOpen: true, last: 'inspector', cause: 'deselect' }), 'conversation');
  assert.equal(dockTab({ selected: true, roomOpen: false, last: 'conversation', cause: 'room-close' }), 'inspector');
  assert.equal(dockTab({ selected: true, roomOpen: false, last: 'conversation', cause: 'room-pop' }), 'inspector');
});
test("the person's tab click wins until the next cause", () => {
  let last = dockTab({ selected: true, roomOpen: true, pinned: true, last: 'conversation', cause: 'click-inspector' });
  assert.equal(last, 'inspector');
  last = dockTab({ selected: true, roomOpen: true, pinned: true, last, cause: null }); // a re-read keeps it
  assert.equal(last, 'inspector');
  last = dockTab({ selected: true, roomOpen: true, pinned: false, last: 'inspector', cause: 'click-conversation' });
  assert.equal(last, 'conversation');
  assert.equal(dockTab({ selected: true, roomOpen: true, pinned: false, last, cause: null }), 'conversation'); // unpinned, still the click's
  assert.equal(dockTab({ selected: true, roomOpen: true, pinned: false, last, cause: 'select' }), 'inspector'); // the next cause
  assert.equal(dockTab({ selected: false, roomOpen: true, last: 'conversation', cause: 'click-inspector' }), 'conversation'); // nothing to inspect
});
test('a re-read with no tab yet follows the pin', () => {
  assert.equal(dockTab({ selected: true, roomOpen: true, pinned: true, last: null }), 'conversation');
  assert.equal(dockTab({ selected: true, roomOpen: true, pinned: false, last: null }), 'inspector');
});
test('the layout preference reads old, broken and new values', () => {
  assert.deepEqual(readLayout(null), { docked: true, floating: null, userPosition: false });
  assert.deepEqual(readLayout('{not json'), { docked: true, floating: null, userPosition: false });
  assert.deepEqual(readLayout('[1,2]'), { docked: true, floating: null, userPosition: false });
  assert.deepEqual(readLayout('{"left":10,"top":60,"width":700,"height":500,"userPosition":true}'), { docked: true, floating: { left: 10, top: 60, width: 700, height: 500 }, userPosition: true });
  assert.deepEqual(readLayout('{"left":10,"top":60,"width":700,"userPosition":true}'), { docked: true, floating: null, userPosition: false }); // incomplete place
  assert.equal(readLayout('{"docked":false}').docked, false);
  assert.equal(readLayout('{"docked":true,"left":1,"top":2,"width":3,"height":4}').docked, true);
  assert.equal(readLayout('{"docked":"no"}').docked, true); // only false pops it out
});
test('merging keeps what the patch does not name', () => {
  const old = '{"left":10,"top":60,"width":700,"height":500,"userPosition":true}';
  const popped = JSON.parse(mergeLayout(old, { docked: false }));
  assert.deepEqual(popped, { left: 10, top: 60, width: 700, height: 500, userPosition: true, docked: false });
  const moved = JSON.parse(mergeLayout(JSON.stringify(popped), { left: 40, top: 70, width: 720, height: 520, userPosition: true }));
  assert.equal(moved.docked, false); assert.equal(moved.left, 40);
  assert.deepEqual(JSON.parse(mergeLayout(null, { docked: false })), { docked: false });
  assert.deepEqual(JSON.parse(mergeLayout('{oops', { docked: true })), { docked: true });
  const placed = JSON.parse(mergeLayout('{"docked":false}', { left: 1, top: 2, width: 3, height: 4, userPosition: false }));
  assert.deepEqual(placed, { left: 1, top: 2, width: 3, height: 4, userPosition: false, docked: false });
});
test('the dock sizes are the ones the rules state', () => {
  assert.equal(DOCK_MIN_W, 420); assert.equal(DOCK_OPEN_W, 480); assert.equal(DOCK_MIN_HOST, 1100);
});
