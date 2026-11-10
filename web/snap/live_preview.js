// SNAP-R1/R2: execution-tagged preview frames, separate from saved outputs and node snapshots.
export function createLivePreviews(resolve, { createURL = URL.createObjectURL, revokeURL = URL.revokeObjectURL } = {}) {
  const frames = new Map();
  let job = null;
  function clear(id = null) {
    const changed = [];
    for (const [key, frame] of frames) if (id == null || frame.job === id) { revokeURL(frame.src); frames.delete(key); changed.push(key); }
    if (!frames.size) job = null;
    return changed;
  }
  return {
    accept(data) {
      const target = resolve(data);
      if (!target || !data.blob) return null;
      if (job !== target.job) clear();
      job = target.job;
      const previous = frames.get(target.brick);
      const frame = { ...target, src: createURL(data.blob) };
      frames.set(target.brick, frame);
      if (previous) revokeURL(previous.src);
      return frame;
    },
    get(brick, graph) { const frame = frames.get(brick); return frame?.graph === graph ? frame : null; },
    clear,
  };
}
