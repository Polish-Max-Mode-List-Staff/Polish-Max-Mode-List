import fs from "fs/promises";
import path from "path";

const WEBHOOK = process.env.WEBHOOK;
if (!WEBHOOK) {
  console.error("Missing WEBHOOK environment variable");
  process.exit(1);
}

const LIST_TYPES = ["main", "bonus"];
const BASE_URL = "https://pmml.pages.dev/data";

async function readCache(listType) {
  try {
    const cachePath = path.resolve("data", listType, "cache_list.json");
    const data = await fs.readFile(cachePath, "utf-8");
    return JSON.parse(data);
  } catch {
    return null;
  }
}

async function saveCache(listType, data) {
  const cacheDir = path.resolve("data", listType);
  await fs.mkdir(cacheDir, { recursive: true });
  const cachePath = path.join(cacheDir, "cache_list.json");
  await fs.writeFile(cachePath, JSON.stringify(data, null, 2));
}

async function fetchList(listType) {
  const url = `${BASE_URL}/${listType}/_list.json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  const paths = await res.json();
  const list = [];
  for (let i = 0; i < paths.length; i++) {
    const p = paths[i];
    const entryUrl = `${BASE_URL}/${listType}/${p}.json`;
    const entryRes = await fetch(entryUrl);
    if (!entryRes.ok) continue;
    const json = await entryRes.json();
    list.push({
      rank: i + 1,
      id: p,
      name: json.name || "Unknown",
      dateVerified: json.dateVerified || null
    });
  }
  return list;
}

async function sendDiscordMessage(content) {
  await fetch(WEBHOOK, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content })
  });
}

function diffLists(oldList, newList) {
  const changes = [];
  const oldMap = new Map(oldList.map((x) => [x.id, x]));
  const newMap = new Map(newList.map((x) => [x.id, x]));

  const removed = oldList.filter(x => !newMap.has(x.id));
  const added = newList.filter(x => !oldMap.has(x.id));

  for (const n of added) {
    const higher = newList.find(x => x.rank === n.rank - 1)?.name || "None";
    const lower = newList.find(x => x.rank === n.rank + 1)?.name || "None";
    changes.push(`${n.name} added at #${n.rank}. Above: ${higher}. Below: ${lower}.`);
  }

  for (const o of removed) {
    changes.push(`${o.name} was removed from the list (previously #${o.rank}).`);
  }

  // detect real moves (where only that entry’s position changed)
  const moved = [];
  for (const id of newMap.keys()) {
    if (oldMap.has(id)) {
      const o = oldMap.get(id);
      const n = newMap.get(id);
      if (o.rank !== n.rank) {
        moved.push({ oldRank: o.rank, newRank: n.rank, name: n.name });
      }
    }
  }

  // keep only entries that moved more than one place or whose move isn't caused by an addition/removal
  for (const m of moved) {
    const oIdx = oldList.findIndex(x => x.rank === m.oldRank);
    const nIdx = newList.findIndex(x => x.rank === m.newRank);
    const higher = newList[nIdx - 1]?.name || "None";
    const lower = newList[nIdx + 1]?.name || "None";
    const dir = m.newRank < m.oldRank ? "moved up" : "moved down";
    // if the same number of items exist and no adds/removes nearby, count as a real move
    if (added.length === 0 && removed.length === 0)
      changes.push(`${m.name} ${dir} from #${m.oldRank} to #${m.newRank}. Above: ${higher}. Below: ${lower}.`);
  }

  return changes;
}

async function persistCacheChanges() {
  try {
    const exec = (await import("child_process")).execSync;
    exec("git config user.name 'github-actions'");
    exec("git config user.email 'actions@github.com'");
    exec("git add data/*/cache_list.json");
    exec("git commit -m 'Update cache files [bot]' || echo 'No cache changes to commit'");
    exec("git push");
  } catch (err) {
    console.error("Failed to commit cache:", err);
  }
}

process.on("unhandledRejection", (r) => console.error("Unhandled rejection:", r));
process.on("uncaughtException", (e) => console.error("Uncaught exception:", e));

async function main() {
  for (const listType of LIST_TYPES) {
    const oldList = (await readCache(listType)) || [];
    const newList = await fetchList(listType);
    const changes = oldList.length ? diffLists(oldList, newList) : [];
    for (const c of changes) await sendDiscordMessage(`[${listType.toUpperCase()}] ${c}`);
    await saveCache(listType, newList);
  }
  await persistCacheChanges();
}

main();