// SNAP-R71/R72/R270: real Picture 1 init, native canvas, AV retention, and New view replay.
// CPU-only: node tests/snap/test_view_init.js (graph contracts; no model execution).
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const pack = path.resolve(__dirname, '../..'), read = (p) => fs.readFileSync(path.join(pack, p), 'utf8');
const source = (p) => read(p).replace(/^import .*;$/gm, '').replace(/^export /gm, '');
const methods = JSON.parse(read('snap_cards/methods.json')).methods;
const plain = (v) => JSON.parse(JSON.stringify(v));
let queued, saved;
const ctx = vm.createContext({
  C: { kind() {}, create: async (d, c) => { saved = plain(d); return { id: 'decision-test', candidates: c }; } },
  RT: { takeCandidate: {}, shotOf: () => null },
  S: { load: async () => {}, list: () => methods.filter((m) => m.slot === 'view').map((m) => ({ ...m, install_state: 'ready' })), slot: () => ({ purposes: { set: { method: 'ph3_view' } } }) },
  M: { load: async () => {}, choice: async (_, __, file) => file },
  T: { load: async () => {}, groupOf: () => 'group-test', get: () => null },
  W: { load: async () => {}, all: () => [] },
  SC: { load: async () => {}, current: () => null },
  K: { queue: async (g, opts) => { queued = plain({ g, opts }); return 'prompt-test'; } },
  api: { fetchApi: async () => ({ json: async () => ({ input_exists: true }) }) },
});
vm.runInContext(source('web/snap/edits.js'), ctx);
async function make(method, denoise, size = {}) {
  ctx.args = [[{ file: 'collage.png' }, { file: 'actor.png' }, { file: 'set.png' }], 'Unify the scene.', { method, seeds: [37], land: 'tab', ...size, ...(denoise === undefined ? {} : { denoise }) }];
  const out = plain(await vm.runInContext('fromContext(...args)', ctx));
  return { out, ...queued, saved };
}
(async () => {
  for (const method of ['ph3_view', 'qwen21_view']) {
    for (const size of [{}, { width: 1280, height: 704 }]) {
      const full = await make(method, undefined, size), one = await make(method, 1, size), partial = await make(method, .7, size), g = partial.g;
      assert.deepEqual(one, full, 'omitted and full denoise preserve every graph and provenance value');
      assert.equal(full.g.ie, undefined);
      assert.deepEqual(g.p, full.g.p, 'conditioning references and prompt unchanged');
      assert.deepEqual(g.iz.inputs.latent, full.g.k.inputs.latent_image, 'size comes from native empty target');
      assert.deepEqual(g.iw.inputs, { expression: 'a * 16', 'values.a': ['iz', 0] });
      assert.deepEqual(g.ih.inputs, { expression: 'a * 16', 'values.a': ['iz', 1] });
      assert.deepEqual(g.ib.inputs, { image: g.p.inputs['images.image_1'], batch_index: 0, length: 1 });
      assert.deepEqual(g.ip.inputs, { image: ['ib', 0], upscale_method: 'lanczos', width: ['iw', 1], height: ['ih', 1], crop: 'disabled' });
      assert.deepEqual(g.ie, { class_type: 'VAEEncode', inputs: { pixels: ['ip', 0], vae: ['3', 0] } });
      if (method === 'ph3_view') {
        assert.deepEqual(g.k.inputs.latent_image, ['il', 0]);
        assert.deepEqual(g.ia.inputs.av_latent, ['p', 1]);
        assert.deepEqual(g.il.inputs, { video_latent: ['ie', 0], audio_latent: ['ia', 1] });
        assert.deepEqual(g.is.inputs, { model: ['4', 0], sigmas: ['m', 0], inject: .7, steps: 0 });
        assert.deepEqual(g.k.inputs.sigmas, ['is', 0]);
        assert.deepEqual(g.r, full.g.r, 'noise stays enabled');
      } else {
        assert.deepEqual(g.k.inputs.latent_image, ['ie', 0]);
        assert.equal(g.k.inputs.denoise, .7);
        assert.equal(g.il, undefined);
      }
      assert.deepEqual(partial.saved.options.init, partial.opts.extra.snap_parent.options.init);
      assert.deepEqual(partial.out.init, partial.saved.options.init);
      assert.equal(partial.out.init.picture, 1);
      assert.equal(partial.out.init.denoise, .7);
      for (const [key, value] of Object.entries(size)) assert.equal(partial.opts.extra.snap_parent.options[key], value);
    }
  }
  assert.equal((await make('qwen21_view', 0)).g.k.inputs.denoise, 0);
  await assert.rejects(make('ph3_view', 0), /H3DeropeSigmas/);
  await assert.rejects(make('fizgig_still', .7), /supported by/);
  await assert.rejects(make('ph3_view', NaN), /denoise must/);
  // Exercise the actual replay implementation, capturing its fromContext arguments.
  let replay;
  const r = vm.createContext({ ED: { fromContext: async (...args) => { replay = plain(args); return { decision: 'd', candidates: [] }; } }, RT: { shotOf: () => null }, W: {}, C: { kind() {} } });
  vm.runInContext(source('web/snap/rerun.js'), r);
  r.take = { id: 'take-test', number: 1, seed: 37, parent: { method: 'view/ph3_view', options: { prompt: 'unify', context: [{ file: 'collage.png', n: 1, label: 'collage' }], purpose: 'set', init: { denoise: .7 }, width: 1280, height: 704 } } };
  await vm.runInContext('rerunView(take, [], {seed: "same", by: "agent"})', r);
  assert.equal(replay[2].denoise, .7);
  assert.equal(replay[2].width, 1280);
  assert.equal(replay[2].height, 704);
  assert.deepEqual(replay[2].seeds, [37]);
  // The tool's actual run forwards the optional argument to the same boundary.
  const tool = read('web/snap/tools.js').split('    name: "edit_from_context",')[1].split('    name: "make_character_sheet",')[0];
  const run = tool.match(/run: (async \([\s\S]*?\n      return [\s\S]*?; \})/)[1];
  const t = vm.createContext({ ED: { fromContext: async (...args) => { replay = plain(args); return { decision: 'd' }; } }, nextPick: async () => ({}) });
  t.opts = { pictures: [{ file: 'collage.png' }], prompt: 'unify', denoise: .7 };
  await vm.runInContext(`(${run})(opts)`, t);
  assert.equal(replay[2].denoise, .7);
  console.log('view_init PASS (default equivalence, native canvas, encoded target, ordered conditioning, AV audio, schedules, provenance, replay, tool forwarding)');
})().catch((e) => { console.error(e); process.exitCode = 1; });
