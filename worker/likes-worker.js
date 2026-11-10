// メゾンパラボラ アーカイブ：いいね保存用 Worker（KV バインディング名：LIKES）
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};
const json = (d, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { "Content-Type": "application/json", ...CORS } });

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
    const url = new URL(req.url);
    if (req.method === "GET" && url.pathname === "/likes") {
      const counts = (await env.LIKES.get("counts", "json")) || {};
      return json(counts);
    }
    if (req.method === "GET" && url.pathname === "/recent") {
      const recent = (await env.LIKES.get("recent", "json")) || [];
      return json(recent);
    }
    if (req.method === "POST" && url.pathname === "/like") {
      let b;
      try { b = await req.json(); } catch { return json({ error: "bad json" }, 400); }
      const id = String(b.id || ""), uid = String(b.uid || "");
      if (!/^\d{10,25}$/.test(id) || !/^[a-z0-9]{8,40}$/.test(uid)) return json({ error: "bad id" }, 400);
      const key = "u:" + uid + ":" + id;
      const had = await env.LIKES.get(key);
      const counts = (await env.LIKES.get("counts", "json")) || {};
      if (had) {
        await env.LIKES.delete(key);
        counts[id] = Math.max(0, (counts[id] || 0) - 1);
        if (!counts[id]) delete counts[id];
      } else {
        await env.LIKES.put(key, "1");
        counts[id] = (counts[id] || 0) + 1;
      }
      await env.LIKES.put("counts", JSON.stringify(counts));
      // 最近いいねされた順（[id, 時刻] の配列、新しい順・最大200件）
      let recent = (await env.LIKES.get("recent", "json")) || [];
      if (!had) {
        recent = recent.filter((r) => r[0] !== id);
        recent.unshift([id, Date.now(), "l"]);
      } else if (!counts[id]) {
        const mc0 = (await env.LIKES.get("mcounts", "json")) || {};
        if (!mc0[id]) recent = recent.filter((r) => r[0] !== id);
      }
      await env.LIKES.put("recent", JSON.stringify(recent.slice(0, 200)));
      return json({ id, liked: !had, count: counts[id] || 0 });
    }
    if (req.method === "GET" && url.pathname === "/minus") {
      const mc = (await env.LIKES.get("mcounts", "json")) || {};
      return json(mc);
    }
    if (req.method === "POST" && url.pathname === "/minus") {
      let b;
      try { b = await req.json(); } catch { return json({ error: "bad json" }, 400); }
      const id = String(b.id || ""), uid = String(b.uid || "");
      if (!/^\d{10,25}$/.test(id) || !/^[a-z0-9]{8,40}$/.test(uid)) return json({ error: "bad id" }, 400);
      const key = "m:" + uid + ":" + id;
      const had = await env.LIKES.get(key);
      const mc = (await env.LIKES.get("mcounts", "json")) || {};
      if (had) {
        await env.LIKES.delete(key);
        mc[id] = Math.max(0, (mc[id] || 0) - 1);
        if (!mc[id]) delete mc[id];
      } else {
        await env.LIKES.put(key, "1");
        mc[id] = (mc[id] || 0) + 1;
      }
      await env.LIKES.put("mcounts", JSON.stringify(mc));
      let recent = (await env.LIKES.get("recent", "json")) || [];
      if (!had) {
        recent = recent.filter((r) => r[0] !== id);
        recent.unshift([id, Date.now(), "m"]);
      } else if (!mc[id]) {
        const c0 = (await env.LIKES.get("counts", "json")) || {};
        if (!c0[id]) recent = recent.filter((r) => r[0] !== id);
      }
      await env.LIKES.put("recent", JSON.stringify(recent.slice(0, 200)));
      return json({ id, minused: !had, count: mc[id] || 0 });
    }
    return json({ error: "not found" }, 404);
  },
};
