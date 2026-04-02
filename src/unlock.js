function computeSubjectStates(plan, approvedIds) {
  const approvedSet = new Set(approvedIds);
  const states = {};

  for (const subject of plan.subjects) {
    if (approvedSet.has(subject.id)) {
      states[subject.id] = "approved";
      continue;
    }

    const required = new Set([
      ...subject.prerequisites.cursadas,
      ...subject.prerequisites.aprobadas,
    ]);

    const unlocked = Array.from(required).every((reqId) => approvedSet.has(reqId));
    states[subject.id] = unlocked ? "unlocked" : "locked";
  }

  return states;
}

module.exports = {
  computeSubjectStates,
};
