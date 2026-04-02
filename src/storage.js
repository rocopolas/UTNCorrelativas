const fs = require("fs");
const path = require("path");

const STORE_PATH = path.join(__dirname, "..", "data", "store.json");

function readStore() {
  const raw = fs.readFileSync(STORE_PATH, "utf8");
  return JSON.parse(raw);
}

function writeStore(store) {
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
}

module.exports = {
  readStore,
  writeStore,
};
