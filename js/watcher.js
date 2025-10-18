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

async function fetchLevelMeta(listType, levelPath) {
  const url = `${BASE_URL}/${listType}/${levelPath}.json`;
  try {
    const level = await fetchJson(url);
    const game = level.game || levelPath;
    return { path: levelPath, game };
  } catch {
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

function computeChanges(oldList, newList) {
  const oldPaths = oldList.map(l => l.path);
  const newPaths = newList.map(l => l.path);
  const added = newPaths.filter(p => !oldPaths.includes(p));
  const removed = oldPaths.filter(p => !newPaths.includes(p));
  const oldFiltered = oldPaths.filter(p => newPaths.includes(p));
  const newFiltered = newPaths.filter(p => oldPaths.includes(p));
  const dp = Array(oldFiltered.length + 1).fill(null).map(() => Array(newFiltered.length + 1).fill(0));
  for (let i = oldFiltered.length - 1; i >= 0; i--) {
    for (let j = newFiltered.length - 1; j >= 0; j--) {
      if (oldFiltered[i] === newFiltered[j]) dp[i][j] = 1 + dp[i + 1][j + 1];
      else dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const lcs = [];
  let i = 0, j = 0;
  while (i < oldFiltered.length && j < newFiltered.length) {
    if (oldFiltered[i] === newFiltered[j]) {
      lcs.push(oldFiltered[i]);
      i++; j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  const moved = newFiltered.filter(p => !lcs.includes(p));
  return { added, removed, moved };
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
  added.forEach(a => lines.push(`${a.game} added to the ${listType} list at #${a.rank}.`));
  removed.forEach(r => lines.push(`${r.game} removed from the ${listType} list (was #${r.rank}).`));
  moved.forEach(m => {
    const dir = m.newRank < m.oldRank ? "moved up" : "moved down";
    lines.push(`${m.game} ${dir} on ${listType}: #${m.oldRank} → #${m.newRank}.`);
  });
  return lines;
}

async function checkList(listType) {
  const currentPaths = await fetchListPaths(listType);
  const oldCache = readCache(listType);
  if (!oldCache) {
    writeCache(listType, await Promise.all(currentPaths.map(async p => await fetchLevelMeta(listType, p))));
    return;
  }
  const oldMap = Object.fromEntries(oldCache.map((x, i) => [x.path, i]));
  const currentMeta = [];
  for (const path of currentPaths) {
    if (oldMap[path] !== undefined) currentMeta.push({ path, game: oldCache[oldMap[path]].game });
    else currentMeta.push(await fetchLevelMeta(listType, path));
  }
  const { added, removed, moved } = computeChanges(oldCache, currentMeta);
  if (added.length === 0 && removed.length === 0 && moved.length === 0) {
    writeCache(listType, currentMeta);
    return;
  }
  const addedMeta = currentMeta.filter(x => added.includes(x.path)).map((x, i) => ({ ...x, rank: i + 1 }));
  const removedMeta = oldCache.filter(x => removed.includes(x.path)).map((x, i) => ({ ...x, rank: i + 1 }));
  const movedMeta = currentMeta.filter(x => moved.includes(x.path)).map(x => {
    const oldRank = oldCache.findIndex(o => o.path === x.path) + 1;
    const newRank = currentMeta.findIndex(n => n.path === x.path) + 1;
    return { ...x, oldRank, newRank };
  });
  const lines = composeMessages(listType, addedMeta, removedMeta, movedMeta);
  const embed = {
    title: `Demon List changes — ${listType}`,
    description: lines.join("\n"),
    color: 0x2b2d31,
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
}

main();