function isEnded(project) {
  return project.ended === true;
}

export function stabilizeProjectOrder(previousProjects, incomingProjects) {
  const incomingById = new Map(incomingProjects.map((project) => [project.id, project]));
  const previousById = new Map(previousProjects.map((project) => [project.id, project]));
  const retainedIds = previousProjects.map((project) => project.id).filter((id) => incomingById.has(id));
  const newIds = incomingProjects.map((project) => project.id).filter((id) => !previousById.has(id));
  const ordered = [...retainedIds, ...newIds].map((id) => incomingById.get(id));
  const lifecycleChanged = previousProjects.length !== incomingProjects.length
    || ordered.some((project) => isEnded(previousById.get(project.id) ?? {}) !== isEnded(project));

  if (!lifecycleChanged) return ordered;
  return [...ordered.filter((project) => !isEnded(project)), ...ordered.filter(isEnded)];
}
