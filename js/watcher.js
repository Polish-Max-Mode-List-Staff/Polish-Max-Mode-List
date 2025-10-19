import fs from "fs/promises";
import path from "path";
import fetch from "node-fetch";

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
    console.warn(`No existing cache for ${listType}`);
    return null;
  }
}

async function saveCache(listType, data) {
  try {
    const cacheDir = path.resolve("data", listType);
    await fs.mkdir(cacheDir, { recursive: true });
    const cachePath = path.join(cacheDir, "cache_list.json");
    await fs.writeFile(cachePath, JSON.stringify(data, null, 2));
    console.log(`Cache saved: ${cachePath}`);
  } catch (err) {
    console.error(`Failed to save cache for ${listType}:`, err);
    throw err;
  }
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
      game: json.game || "Unknown",
      dateVerified: json.dateVerified || null
    });
  }
  return list;
}

async function sendDiscordMessage(content) {
  try {
    await fetch(WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content })
    });
    console.log("Sent Discord message:", content);
  } catch (err) {
    console.error("Failed to send Discord message:", err);
  }
}

function diffLists(oldList, newList) {
  const changes = [];
  const oldMap = new Map(oldList.map((x) => [x.id, x]));
  const newMap = new Map(newList.map((x) => [x.id, x]));

  for (const id of newMap.keys()) {
    if (!oldMap.has(id)) {
      const n = newMap.get(id);
      changes.push(`${n.game} added to the ${n.rank <= 100 ? "list" : "legacy"}. It is now #${n.rank}.`);
    } else {
      const o = oldMap.get(id);
      const n = newMap.get(id);
      if (o.rank !== n.rank) {
        const dir = n.rank < o.rank ? "moved up" : "moved down";
        changes.push(`${n.game} ${dir} from #${o.rank} to #${n.rank}.`);
      }
    }
  }

  for (const id of oldMap.keys()) {
    if (!newMap.has(id)) {
      const o = oldMap.get(id);
      changes.push(`${o.game} was removed from the list (previously #${o.rank}).`);
    }
  }

  return changes;
}

async function main() {
  console.log("Starting Demon List watcher...");
  for (const listType of LIST_TYPES) {
    console.log("Checking list:", listType);
    const oldList = (await readCache(listType)) || [];
    const newList = await fetchList(listType);
    const changes = oldList.length ? diffLists(oldList, newList) : [];

    if (changes.length > 0) {
      for (const c of changes) {
        await sendDiscordMessage(`[${listType.toUpperCase()}] ${c}`);
      }
    } else {
      console.log(`No changes detected in ${listType} list`);
    }

    await saveCache(listType, newList);
  }

  // persist cache to repo for next run
  await persistCacheChanges();
}

async function persistCacheChanges() {
  try {
    const exec = (await import("child_process")).execSync;
    exec("git config user.name 'github-actions'");
    exec("git config user.email 'actions@github.com'");
    exec("git add data/*/cache_list.json");
    exec("git commit -m 'Update cache files [bot]' || echo 'No cache changes to commit'");
    exec("git push");
    console.log("Cache committed to repository");
  } catch (err) {
    console.error("Failed to commit cache:", err);
  }
}

process.on("unhandledRejection", (r) => console.error("Unhandled rejection:", r));
process.on("uncaughtException", (e) => console.error("Uncaught exception:", e));

main();