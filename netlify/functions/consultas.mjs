// Conversaciones por frente de "Gestores del Cambio".
// Cada mensaje y cada marca de "leído" se guardan como blobs separados en el store
// "consultas" — así nunca se pisan con el tablero (/api/board) ni entre ellos.
//
// Endpoint: /.netlify/functions/consultas
//   GET   -> { mensajes: [...], leidos: { <usuario>: { <frenteId>: <iso> } } }
//   POST  {tipo:"mensaje", user, frenteId, frente, texto} -> guarda un mensaje
//   POST  {tipo:"leido",   user, frenteId}                -> marca la conversación como leída
//   POST  {tipo:"borrar",  user, id}                      -> borra el mensaje sin dejar rastro
import { getStore } from "@netlify/blobs";

// Slug ASCII para usar en las claves (Hernán -> hernan).
const USUARIOS = { Rafa: "rafa", Guille: "guille", Facu: "facu", "Hernán": "hernan" };
const SLUG_A_USUARIO = Object.fromEntries(Object.entries(USUARIOS).map(([u, s]) => [s, u]));
const ID_OK = /^[A-Za-z0-9-]{1,64}$/;
const MSG_ID_OK = /^\d{13}_[a-z0-9]{1,8}$/;
const ADMIN = "Hernán";

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
    if (!slug) return new Response("Datos inválidos", { status: 400 });
    const now = Date.now();
    const ts = new Date(now).toISOString();

    // Borrado limpio: se elimina el mensaje y su registro en la bitácora de actividad,
    // sin dejar marca. Cada uno borra lo suyo; Hernán puede borrar cualquiera.
    if (body.tipo === "borrar") {
      const id = String(body.id || "");
      if (!MSG_ID_OK.test(id)) return new Response("Datos inválidos", { status: 400 });
      const mensaje = await store.get(`m/${id}`, { type: "json" });
      if (!mensaje) return Response.json({ ok: true }); // ya no existe
      if (mensaje.user !== body.user && body.user !== ADMIN) {
        return new Response("Solo podés borrar tus propios mensajes", { status: 403 });
      }
      await store.delete(`m/${id}`);
      await getStore("actividad").delete(`${id}_m`);
      return Response.json({ ok: true });
    }

    if (!ID_OK.test(String(body.frenteId || ""))) {
      return new Response("Datos inválidos", { status: 400 });
    }

    if (body.tipo === "mensaje") {
      const texto = txt(body.texto, 2000).trim();
      if (!texto) return new Response("Mensaje vacío", { status: 400 });
      const id = `${now}_${Math.random().toString(36).slice(2, 8)}`;
      const mensaje = { id, ts, user: body.user, frenteId: body.frenteId, frente: txt(body.frente, 200), texto };
      await store.setJSON(`m/${id}`, mensaje);
      // Quien escribe, obviamente leyó la conversación.
      await store.set(`l/${slug}/${body.frenteId}`, ts);
      // Registro en la bitácora de actividad con una clave atada al mensaje, para poder
      // borrarlo junto con él. Empieza con el mismo timestamp, así ordena igual que el resto.
      await getStore("actividad").setJSON(`${id}_m`, {
        ts, user: body.user, tipo: "mensaje", frente: mensaje.frente, msgId: id,
        cambios: [{ campo: "Mensaje", de: "", a: txt(texto, 300) }],
      });
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
