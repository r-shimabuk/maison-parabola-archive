// メゾンパラボラ アーカイブ：いいね・マイナス保存用 Worker
// 保存先：D1（バインディング名 DB）。旧データの引き継ぎ用に KV（LIKES）も残しています。
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};
const json = (d, s = 200) =>
  new Response(JSON.stringify(d), {
    status: s,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...CORS },
  });

async function ver(env) {
  const r = await env.DB.prepare("SELECT v FROM meta WHERE k='v'").first();
  return r ? r.v : 0;
}

async function state(env) {
  const { results } = await env.DB.prepare(
    "SELECT id, kind, COUNT(*) AS c, MAX(t) AS t FROM votes GROUP BY id, kind"
  ).all();
  const likes = {}, minus = {}, last = {};
  for (const r of results) {
    if (r.kind === "l") likes[r.id] = r.c;
    else minus[r.id] = r.c;
    if (!last[r.id] || r.t > last[r.id][1]) last[r.id] = [r.id, r.t, r.kind];
  }
  const recent = Object.values(last).sort((a, b) => b[1] - a[1]).slice(0, 200);
  return { v: await ver(env), likes, minus, recent };
}

async function toggle(env, kind, b) {
  const id = String(b.id || ""), uid = String(b.uid || "");
  if (!/^\d{10,25}$/.test(id) || !/^[a-z0-9]{8,40}$/.test(uid)) return json({ error: "bad id" }, 400);
  const had = await env.DB.prepare("SELECT 1 AS x FROM votes WHERE uid=? AND id=? AND kind=?").bind(uid, id, kind).first();
  const ops = [
    had
      ? env.DB.prepare("DELETE FROM votes WHERE uid=? AND id=? AND kind=?").bind(uid, id, kind)
      : env.DB.prepare("INSERT INTO votes (uid, id, kind, t) VALUES (?, ?, ?, ?)").bind(uid, id, kind, Date.now()),
    env.DB.prepare("UPDATE meta SET v = v + 1 WHERE k='v'"),
    env.DB.prepare("SELECT COUNT(*) AS c FROM votes WHERE id=? AND kind=?").bind(id, kind),
    env.DB.prepare("SELECT v FROM meta WHERE k='v'"),
  ];
  const res = await env.DB.batch(ops);
  const count = res[2].results[0].c, v = res[3].results[0].v;
  return kind === "l"
    ? json({ id, liked: !had, count, v })
    : json({ id, minused: !had, count, v });
}

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
    const url = new URL(req.url), p = url.pathname;
    try {
      if (req.method === "GET" && p === "/ver") return json({ v: await ver(env) });
      if (req.method === "GET" && p === "/state") return json(await state(env));
      // 古い画面との互換用
      if (req.method === "GET" && p === "/likes") return json((await state(env)).likes);
      if (req.method === "GET" && p === "/minus") return json((await state(env)).minus);
      if (req.method === "GET" && p === "/recent") return json((await state(env)).recent);
      if (req.method === "POST" && (p === "/like" || p === "/minus")) {
        let b;
        try { b = await req.json(); } catch { return json({ error: "bad json" }, 400); }
        return await toggle(env, p === "/like" ? "l" : "m", b);
      }
      // 一度だけ使う：表の作成と KV からの引き継ぎ
      if (req.method === "POST" && p === "/setup-mp2026") {
        await env.DB.batch([
          env.DB.prepare("CREATE TABLE IF NOT EXISTS votes (uid TEXT NOT NULL, id TEXT NOT NULL, kind TEXT NOT NULL, t INTEGER NOT NULL, PRIMARY KEY (uid, id, kind))"),
          env.DB.prepare("CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v INTEGER NOT NULL)"),
          env.DB.prepare("INSERT OR IGNORE INTO meta (k, v) VALUES ('v', 0)"),
        ]);
        const recent = (await env.LIKES.get("recent", "json")) || [];
        const tm = {};
        for (const r of recent) tm[r[0] + ":" + (r[2] || "l")] = r[1];
        let n = 0, cursor;
        const ops = [];
        for (const prefix of ["u:", "m:"]) {
          cursor = undefined;
          do {
            const l = await env.LIKES.list({ prefix, cursor });
            for (const k of l.keys) {
              const [, uid, id] = k.name.split(":");
              const kind = prefix === "u:" ? "l" : "m";
              ops.push(env.DB.prepare("INSERT OR IGNORE INTO votes (uid, id, kind, t) VALUES (?, ?, ?, ?)").bind(uid, id, kind, tm[id + ":" + kind] || 0));
              n++;
            }
            cursor = l.list_complete ? undefined : l.cursor;
          } while (cursor);
        }
        if (ops.length) await env.DB.batch(ops);
        await env.DB.prepare("UPDATE meta SET v = v + 1 WHERE k='v'").run();
        return json({ migrated: n, state: await state(env) });
      }
    } catch (e) {
      return json({ error: String(e) }, 500);
    }
    return json({ error: "not found" }, 404);
  },
};
