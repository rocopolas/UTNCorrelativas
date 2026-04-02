const fs = require("fs");
const path = require("path");

const STORE_PATH = path.join(__dirname, "..", "data", "store.json");

function createEmptyStore() {
  return { plan: null, progress: { approvedIds: [] } };
}

function normalizeStore(rawStore) {
  if (!rawStore || typeof rawStore !== "object") {
    return createEmptyStore();
  }

  const approvedIds = Array.isArray(rawStore.progress?.approvedIds)
    ? rawStore.progress.approvedIds.filter((id) => Number.isInteger(id))
    : [];

  return {
    plan: rawStore.plan || null,
    progress: {
      approvedIds,
    },
  };
}

function readStore() {
  if (!fs.existsSync(STORE_PATH)) {
    const empty = createEmptyStore();
    writeStore(empty);
    return empty;
  }

  try {
    const raw = fs.readFileSync(STORE_PATH, "utf8");
    return normalizeStore(JSON.parse(raw));
  } catch (_error) {
    const empty = createEmptyStore();
    writeStore(empty);
    return empty;
  }
}

function writeStore(store) {
  const normalized = normalizeStore(store);
  const tmpPath = `${STORE_PATH}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(normalized, null, 2));
  fs.renameSync(tmpPath, STORE_PATH);
}

module.exports = {
  readStore,
  writeStore,
};
