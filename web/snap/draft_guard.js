// SNAP-R2/R7: async sends/actions may clear only their own unchanged project draft.
export function createDraftGuard({ read, project, clear }) {
  let revision = 0;
  return {
    changed() { revision++; },
    capture() { return { project: project(), revision, value: read() }; },
    clearIfCurrent(snapshot) {
      if (!snapshot || snapshot.project !== project() || snapshot.revision !== revision || snapshot.value !== read()) return false;
      clear(snapshot); revision++; return true;
    },
  };
}
