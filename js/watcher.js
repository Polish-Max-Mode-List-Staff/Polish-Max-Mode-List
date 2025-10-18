import fs from "fs";
import fetch from "node-fetch";

const WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const BASE_URL = "https://pmml.pages.dev/data";
const listTypes = ["main", "bonus"];

async function fetchList(listType) {
  const res = await fetch(`${BASE_URL}/${listType}/_list.json`);
  if (!res.ok) throw new Error(`Failed to fetch ${listType} list`);
  return await res.json();
}

async function checkChanges() {
  for (const listType of listTypes) {
    const current = await fetchList(listType);
    const oldPath = `.cache_${listType}.json`;
    let old = [];

    if (fs.existsSync(oldPath)) {
      old = JSON.parse(fs.readFileSync(oldPath, "utf-8"));
    }

    const messages = [];

    // detect new demons
    for (const demon of current) {
      if (!old.includes(demon)) {
        const rank = current.indexOf(demon) + 1;
        messages.push(`🆕 **${demon}** added to the ${listType} list at #${rank}!`);
      }
    }

    // detect removed demons
    for (const demon of old) {
      if (!current.includes(demon)) {
        messages.push(`❌ **${demon}** removed from the ${listType} list.`);
      }
    }

    // detect ranking changes
    for (const demon of current) {
      if (old.includes(demon)) {
        const oldRank = old.indexOf(demon);
        const newRank = current.indexOf(demon);
        if (oldRank !== newRank) {
          messages.push(`🔁 **${demon}** moved from #${oldRank + 1} → #${newRank + 1} on the ${listType} list.`);
        }
      }
    }

    if (messages.length > 0) {
      await fetch(WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: messages.join("\n") }),
      });
    }

    fs.writeFileSync(oldPath, JSON.stringify(current, null, 2));
  }
}

checkChanges().catch(console.error);