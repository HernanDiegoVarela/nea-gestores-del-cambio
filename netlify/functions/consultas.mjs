// Conversaciones por frente de "Gestores del Cambio".
// Cada mensaje y cada marca de "leído" se guardan como blobs separados en el store
// "consultas" — así nunca se pisan con el tablero (/api/board) ni entre ellos.
//
// Endpoint: /.netlify/functions/consultas
//   GET   -> { mensajes: [...], leidos: { <usuario>: { <frenteId>: <iso> } } }
//   POST  {tipo:"mensaje", user, frenteId, frente, texto} -> guarda un mensaje
//   POST  {tipo:"leido",   user, frenteId}                -> marca la conversación como leída
import { getStore } from "@netlify/blobs";

// Slug ASCII para usar en las claves (Hernán -> hernan).
const USUARIOS = { Rafa: "rafa", Guille: "guille", Facu: "facu", "Hernán": "hernan" };
const SLUG_A_USUARIO = Object.fromEntries(Object.entries(USUARIOS).map(([u, s]) => [s, u]));
const ID_OK = /^[A-Za-z0-9-]{1,64}$/;

const txt = (v, max) => String(v ?? "").slice(0, max);

export default async (req) => {
  const store = getStore("consultas");

  if (req.method === "GET") {
    const [{ blobs: msgBlobs }, { blobs: leidoBlobs }] = await Promise.all([
      store.list({ prefix: "m/" }),
      store.list({ prefix: "l/" }),
    ]);
    const mensajes = (
      await Promise.all(msgBlobs.map((b) => store.get(b.key, { type: "json" })))
    )
      .filter(Boolean)
      .sort((a, b) => (a.ts < b.ts ? -1 : 1));

    const leidos = {};
    await Promise.all(
      leidoBlobs.map(async (b) => {
        const [, slug, frenteId] = b.key.split("/");
        const user = SLUG_A_USUARIO[slug];
        if (!user || !frenteId) return;
        const ts = await store.get(b.key);
        if (!ts) return;
        (leidos[user] = leidos[user] || {})[frenteId] = ts;
      })
    );
    return Response.json({ mensajes, leidos }, { headers: { "Cache-Control": "no-store" } });
  }

  if (req.method === "POST") {
    let body;
    try {
      body = await req.json();
    } catch {
      return new Response("JSON inválido", { status: 400 });
    }
    const slug = USUARIOS[body.user];
    if (!slug || !ID_OK.test(String(body.frenteId || ""))) {
      return new Response("Datos inválidos", { status: 400 });
    }
    const now = Date.now();
    const ts = new Date(now).toISOString();

    if (body.tipo === "mensaje") {
      const texto = txt(body.texto, 2000).trim();
      if (!texto) return new Response("Mensaje vacío", { status: 400 });
      const id = `${now}_${Math.random().toString(36).slice(2, 8)}`;
      const mensaje = { id, ts, user: body.user, frenteId: body.frenteId, frente: txt(body.frente, 200), texto };
      await store.setJSON(`m/${id}`, mensaje);
      // Quien escribe, obviamente leyó la conversación.
      await store.set(`l/${slug}/${body.frenteId}`, ts);
      return Response.json({ ok: true, mensaje });
    }

    if (body.tipo === "leido") {
      await store.set(`l/${slug}/${body.frenteId}`, ts);
      return Response.json({ ok: true, ts });
    }

    return new Response("Tipo inválido", { status: 400 });
  }

  return new Response("Método no permitido", { status: 405 });
};
