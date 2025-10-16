export async function fetchList(type = 'main') {
    const listResult = await fetch(`/data/${type}/_list.json`);
    try {
        const list = await listResult.json();
        return await Promise.all(
            list.map(async (path, rank) => {
                const levelResult = await fetch(`/data/${type}/${path}.json`);
                try {
                    const level = await levelResult.json();
                    return [{ ...level, path }, null];
                } catch {
                    console.error(`Failed to load level #${rank + 1} ${path}.`);
                    return [null, path];
                }
            }),
        );
    } catch {
        console.error(`Failed to load list.`);
        return null;
    }
}

export async function fetchLeaderboard(type = 'main') {
    const list = await fetchList(type);
    const scoreMap = {};
    const errs = [];

    list.forEach(([level, err], rank) => {
        if (err) {
            errs.push(err);
            return;
        }

        const verifier = Object.keys(scoreMap).find(
            (u) => u.toLowerCase() === level.verifier.toLowerCase(),
        ) || level.verifier;

        scoreMap[verifier] ??= {
            verified: [],
            completed: [],
        };

        scoreMap[verifier].verified.push({
            rank: rank + 1,
            level: level.name,
            score: score(rank + 1),
            link: level.verification,
        });

        level.records.forEach((record) => {
            const user = Object.keys(scoreMap).find(
                (u) => u.toLowerCase() === record.user.toLowerCase(),
            ) || record.user;

            scoreMap[user] ??= {
                verified: [],
                completed: [],
            };

            scoreMap[user].completed.push({
                rank: rank + 1,
                level: level.name,
                score: score(rank + 1),
                link: record.link,
            });
        });
    });

    const res = Object.entries(scoreMap).map(([user, scores]) => {
        const { verified, completed } = scores;
        const total = [verified, completed].flat().reduce((prev, cur) => prev + cur.score, 0);
        return {
            user,
            total: round(total),
            ...scores,
        };
    });

    return [res.sort((a, b) => b.total - a.total), errs];
}

import MainList from './pages/MainList.js';
import MainLeaderboard from './pages/MainLeaderboard.js';
import SideList from './pages/SideList.js';
import SideLeaderboard from './pages/SideLeaderboard.js';

export default [
  { path: '/', component: MainList },
  { path: '/leaderboard', component: MainLeaderboard },
  { path: '/side', component: SideList },
  { path: '/side/leaderboard', component: SideLeaderboard },
];

