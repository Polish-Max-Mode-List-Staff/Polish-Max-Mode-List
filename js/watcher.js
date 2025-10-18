  process.exit(1);
});// js/demonlist-watcher.js
import fs from "fs";

const WEBHOOK_URL = process.env.WEBHOOK;
if (!WEBHOOK_URL) {
  console.error("Missing WEBHOOK environment variable.");
  process.exit(1);
}

const BASE_URL = "https://pmml.pages.dev/data";
const LIST_TYPES = ["main", "bonus"];
const CACHE_PREFIX = ".cache_";

async function fetchJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} when fetching ${url}`);
  return await r.json();
}

async function fetchListPaths(listType) {
  return await fetchJson(`${BASE_URL}/${listType}/_list.json`);
}

// fetch level meta, using "game" instead of "name"
async function fetchLevelMeta(listType, levelPath) {
  const url = `${BASE_URL}/${listType}/${levelPath}.json`;
  try {
    const level = await fetchJson(url);
    const game = level.game || levelPath;
    return { path: levelPath, game };
  } catch (err) {
    console.warn(`Couldn't fetch ${listType}/${levelPath}: ${err.message}`);
    return { path: levelPath, game: levelPath };
  }
}

function readCache(listType) {
  const file = `./${CACHE_PREFIX}${listType}.json`;
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function writeCache(listType, arr) {
  fs.writeFileSync(`./${CACHE_PREFIX}${listType}.json`, JSON.stringify(arr, null, 2));
}

function indexMap(arr) {
  return arr.reduce((m, x, i) => ((m[x.path] = i), m), {});
}

async function buildMetaArray(listType, paths) {
  const res = [];
  for (const p of paths) res.push(await fetchLevelMeta(listType, p));
  return res;
}

async function sendDiscordMessage(embed) {
  const payload = { embeds: [embed] };
  const r = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!r.ok) console.error(`Failed to send webhook: ${r.status} ${await r.text()}`);
}

function composeMessages(listType, added, removed, moved) {
  const lines = [];
  added.forEach(a => lines.push(`**${a.game}** added to the ${listType} list at #${a.rank}.`));
  removed.forEach(r => lines.push(`**${r.game}** removed from the ${listType} list (was #${r.rank}).`));
  moved.forEach(m => lines.push(`**${m.game}** moved on ${listType}: #${m.oldRank} → #${m.newRank}.`));
  return lines;
}

async function checkList(listType) {
  console.log(`Checking ${listType} list...`);
  const currentPaths = await fetchListPaths(listType);
  const oldCache = readCache(listType);

  // First run → create cache only
  if (!oldCache) {
    console.log(`No cache found for ${listType}, creating initial cache.`);
    writeCache(listType, await buildMetaArray(listType, currentPaths));
    return;
  }

  const oldMap = indexMap(oldCache);
  const currentMeta = [];

  // reuse cached "game" names when possible
  for (const path of currentPaths) {
    if (oldMap[path] !== undefined) {
      currentMeta.push({ path, game: oldCache[oldMap[path]].game });
    } else {
      currentMeta.push(await fetchLevelMeta(listType, path));
    }
  }

  const curMap = indexMap(currentMeta);

  const added = currentMeta
    .filter(x => !oldMap.hasOwnProperty(x.path))
    .map((x, i) => ({ ...x, rank: i + 1 }));

  const removed = oldCache
    .filter(x => !curMap.hasOwnProperty(x.path))
    .map((x, i) => ({ ...x, rank: i + 1 }));

  const moved = currentMeta
    .filter(x => oldMap.hasOwnProperty(x.path))
    .map(x => ({
      ...x,
      oldRank: oldMap[x.path] + 1,
      newRank: curMap[x.path] + 1,
    }))
    .filter(x => x.oldRank !== x.newRank);

  if (added.length === 0 && removed.length === 0 && moved.length === 0) {
    console.log(`No changes for ${listType}.`);
    writeCache(listType, currentMeta);
    return;
  }

  const lines = composeMessages(listType, added, removed, moved);
  const embed = {
    title: `Demon List changes — ${listType}`,
    description: lines.join("\n"),
    color: 0x2b2d31, // dark embed color
    timestamp: new Date().toISOString(),
  };

  await sendDiscordMessage(embed);
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

main();