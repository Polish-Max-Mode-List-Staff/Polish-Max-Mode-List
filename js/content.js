// content.js
import { round, score } from './score.js';

/**
 * Fetch verified list (main or bonus)
 * Structure: /data/{listType}/_list.json
 */
export async function fetchList(listType = 'main') {
    const dir = `/data/${listType}`;
    try {
        const listResult = await fetch(`${dir}/_list.json`);
        const list = await listResult.json();

        return await Promise.all(
            list.map(async (path, rank) => {
                try {
                    const levelResult = await fetch(`${dir}/${path}.json`);
                    const level = await levelResult.json();

                    // unified verified level format
                    return [
                        {
                            ...level,
                            path,
                            rank: rank + 1,
                            listType,
                        },
                        null,
                    ];
                } catch {
                    console.error(`Failed to load ${listType} level #${rank + 1}: ${path}.json`);
                    return [null, path];
                }
            })
        );
    } catch {
        console.error(`Failed to load ${listType} list.`);
        return null;
    }
}

/**
 * Fetch unverified levels
 * Structure: /data/unverified/_list.json
 */
export async function fetchUnverifiedList() {
    const dir = '/data/unverified';
    try {
        const listResult = await fetch(`${dir}/_list.json`);
        const list = await listResult.json();

        return await Promise.all(
            list.map(async (path) => {
                try {
                    const levelResult = await fetch(`${dir}/${path}.json`);
                    const level = await levelResult.json();

                    // unified unverified level format
                    return {
                        name: level.name,
                        game: level.game,
                        developers: level.developers || [],
                        versionToVerify: level.versionToVerify || 'Unknown',
                        dateMade: level.dateMade || 'Unknown',
                        verifier: level.verifier || "None",
                        verification: level.verification || null,
                        projectedPlacementMain: level.projectedPlacementMain || null,
                        projectedPlacementBonus: level.projectedPlacementBonus || null,
                        description: level.description || '',
                    };
                } catch {
                    console.error(`Failed to load unverified level: ${path}.json`);
                    return null;
                }
            })
        );
    } catch {
        console.error('Failed to load unverified list.');
        return null;
    }
}

/**
 * Fetch list editors (unchanged)
 */
export async function fetchEditors() {
    try {
        const editorsResults = await fetch(`/data/_editors.json`);
        const editors = await editorsResults.json();
        return editors;
    } catch {
        return null;
    }
}

/**
 * Fetch leaderboard for a specific list type
 * Generates points and aggregates verifier/victor scores
 */
export async function fetchLeaderboard(listType = 'main') {
    const list = await fetchList(listType);
    if (!list) return [[], []];

    const scoreMap = {};
    const errs = [];

    list.forEach(([level, err], rank) => {
        if (err) {
            errs.push(err);
            return;
        }

        if (!level) return;

        // add verifier score
        const verifierKey = Object.keys(scoreMap).find(
            (u) => u.toLowerCase() === level.verifier.toLowerCase()
        ) || level.verifier;

        scoreMap[verifierKey] ??= { verified: [], completed: [] };

        scoreMap[verifierKey].verified.push({
            rank: rank + 1,
            level: level.name,
            score: score(rank + 1),
            link: level.verification,
        });

        // add victor scores
        level.records?.forEach((record) => {
            const userKey = Object.keys(scoreMap).find(
                (u) => u.toLowerCase() === record.user.toLowerCase()
            ) || record.user;

            scoreMap[userKey] ??= { verified: [], completed: [] };

            scoreMap[userKey].completed.push({
                rank: rank + 1,
                level: level.name,
                score: score(rank + 1),
                link: record.link,
            });
        });
    });

    // convert map to array with totals
    const leaderboard = Object.entries(scoreMap).map(([user, data]) => {
        const { verified, completed } = data;
        const total = [...verified, ...completed].reduce((sum, s) => sum + s.score, 0);
        return {
            user,
            total: round(total),
            verified,
            completed,
        };
    });

    // sort by total score (desc)
    leaderboard.sort((a, b) => b.total - a.total);

    return [leaderboard, errs];
}