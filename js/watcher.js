// js/demonlist-watcher.js
// Node 20+ (uses global fetch). ESM style (top-level await not used)
import fs from "fs";
import path from "path";

const WEBHOOK_URL = process.env.WEBHOOK;
if (!WEBHOOK_URL) {
  console.error("Missing DISCORD_WEBHOOK_URL environment variable.");
  process.exit(1);
}

const BASE_URL = "https://pmml.pages.dev/data";
const LIST_TYPES = ["main", "bonus"];
const CACHE_PREFIX = ".cache_"; // will create .cache_main.json and .cache_bonus.json

async function fetchJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} when fetching ${url}`);
  return await r.json();
}

// Fetch the _list.json (array of paths)
async function fetchListPaths(listType) {
  const url = `${BASE_URL}/${listType}/_list.json`;
  return await fetchJson(url);
}

// Given a path (filename without .json) fetch the level json and return { path, name }
async function fetchLevelMeta(listType, levelPath) {
  const url = `${BASE_URL}/${listType}/${levelPath}.json`;
  try {
    const level = await fetchJson(url);
    const name = level.name || levelPath;
    return { path: levelPath, name };
  } catch (err) {
    console.warn(`Warning: couldn't fetch level meta for ${listType}/${levelPath}: ${err.message}`);
    return { path: levelPath, name: levelPath };
  }
}

function readCache(listType) {
  const p = `./${CACHE_PREFIX}${listType}.json`;
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch {
    return null;
  }
}

function writeCache(listType, arr) {
  const p = `./${CACHE_PREFIX}${listType}.json`;
  fs.writeFileSync(p, JSON.stringify(arr, null, 2));
}

// Build a map from path -> index in array for quick lookup
function indexMap(arr) {
  return arr.reduce((m, item, i) => {
    m[item.path] = i;
    return m;
  }, {});
}

async function buildMetaArray(listType, pathsArray) {
  // pathsArray is array of strings (paths)
  const res = [];
  for (const p of pathsArray) {
    const meta = await fetchLevelMeta(listType, p);
    res.push(meta);
  }
  return res;
}

async function sendDiscordMessage(content) {
  // content: simple string or object for webhook payload
  const payload = typeof content === "string" ? { content } : content;
  const r = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!r.ok) {
    console.error(`Failed sending webhook: ${r.status} ${await r.text()}`);
  }
}

// Compose friendly messages
function composeMessages(listType, added, removed, moved) {
  // added, removed: arrays of {path,name,rank}
  // moved: array of {path,name,oldRank,newRank}
  const lines = [];

  added.forEach(a => lines.push(`🆕 **${a.name}** added to the ${listType} list at #${a.rank}.`));
  removed.forEach(r => lines.push(`❌ **${r.name}** removed from the ${listType} list (was #${r.rank}).`));
  moved.forEach(m => lines.push(`🔁 **${m.name}** moved on ${listType}: #${m.oldRank} → #${m.newRank}.`));

  return lines;
}

async function checkList(listType) {
  console.log(`Checking list: ${listType}`);
  const currentPaths = await fetchListPaths(listType); // array of strings
  if (!Array.isArray(currentPaths)) {
    console.error(`Invalid _list.json for ${listType}`);
    return;
  }

  const cache = readCache(listType);
  if (!cache) {
    // FIRST RUN: build cache with names and exit without sending messages to avoid spam
    console.log(`No cache found for ${listType}. Creating cache and not sending messages on first run.`);
    const metaArr = await buildMetaArray(listType, currentPaths);
    writeCache(listType, metaArr);
    return;
  }

  // cache is array of {path,name}
  const oldArr = cache; // preserve ordering
  const oldIndex = indexMap(oldArr);

  // Build current meta array (with names) — but we can fetch only for new paths;
  // to keep names, we’ll reuse cached names where possible to avoid unnecessary network calls.
  const currentMeta = [];
  for (let i = 0; i < currentPaths.length; i++) {
    const p = currentPaths[i];
    if (oldIndex[p] !== undefined) {
      // reuse name from old cache
      currentMeta.push({ path: p, name: oldArr[oldIndex[p]].name });
    } else {
      // new path -> fetch its name
      const meta = await fetchLevelMeta(listType, p);
      currentMeta.push(meta);
    }
  }

  // Build reverse index maps
  const curIndex = indexMap(currentMeta);

  // Detect added
  const added = [];
  for (let i = 0; i < currentMeta.length; i++) {
    const item = currentMeta[i];
    if (!oldIndex.hasOwnProperty(item.path)) {
      added.push({ path: item.path, name: item.name, rank: i + 1 });
    }
  }

  // Detect removed
  const removed = [];
  for (let i = 0; i < oldArr.length; i++) {
    const item = oldArr[i];
    if (!curIndex.hasOwnProperty(item.path)) {
      removed.push({ path: item.path, name: item.name, rank: i + 1 });
    }
  }

  // Detect moved (present in both but index changed)
  const moved = [];
  for (let i = 0; i < currentMeta.length; i++) {
    const item = currentMeta[i];
    if (oldIndex.hasOwnProperty(item.path)) {
      const oldRank = oldIndex[item.path] + 1;
      const newRank = i + 1;
      if (oldRank !== newRank) {
        moved.push({ path: item.path, name: item.name, oldRank, newRank });
      }
    }
  }

  // If no differences, just update cache and exit
  if (added.length === 0 && removed.length === 0 && moved.length === 0) {
    console.log(`No changes for ${listType}.`);
    writeCache(listType, currentMeta);
    return;
  }

  // Compose message(s). Group by listType into one message to avoid spam.
  const lines = composeMessages(listType, added, removed, moved);
  // We'll send an embed for nicer formatting
  const embed = {
    title: `Demon List changes — ${listType}`,
    description: lines.join("\n"),
    timestamp: new Date().toISOString(),
  };

  await sendDiscordMessage({ embeds: [embed] });

  // Update cache
  writeCache(listType, currentMeta);
}

async function main() {
  for (const lt of LIST_TYPES) {
    try {
      await checkList(lt);
    } catch (err) {
      console.error(`Error checking ${lt}:`, err);
    }
  }
  console.log("Done.");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});