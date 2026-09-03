import { getStore } from "@netlify/blobs";

export default async (req) => {
  const store = getStore("gestores-del-cambio");

  if (req.method === "GET") {
    const data = await store.get("board", { type: "json" });
    return new Response(JSON.stringify(data || null), {
      headers: { "Content-Type": "application/json" },
    });
  }

  if (req.method === "POST") {
    const body = await req.json();
    await store.setJSON("board", body);
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response("Method not allowed", { status: 405 });
};

export const config = { path: "/api/board" };
