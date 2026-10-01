// Bitácora de actividad de "Gestores del Cambio".
// Cada evento (apertura de la app, alta o edición de un frente) se guarda como un blob
// separado en el store "actividad" — así dos personas trabajando a la vez nunca se pisan,
// y el tablero (/api/board) queda intacto.
//
// Endpoint: /.netlify/functions/activity
//   POST  -> registra un evento {user, tipo, frente, cambios[]}
//   GET   -> devuelve los últimos 500 eventos, del más nuevo al más viejo
import { getStore } from "@netlify/blobs";

const USUARIOS = ["Rafa", "Guille", "Facu", "Hernán"];
const TIPOS = ["apertura", "alta", "edicion", "mensaje"];
const MAX_EVENTOS = 500;

const txt = (v, max) => String(v ?? "").slice(0, max);

export default async (req) => {
  const store = getStore("actividad");

  if (req.method === "POST") {
    let ev;
    try {
      ev = await req.json();
    } catch {
      return new Response("JSON inválido", { status: 400 });
    }
    if (!USUARIOS.includes(ev.user) || !TIPOS.includes(ev.tipo)) {
      return new Response("Evento inválido", { status: 400 });
    }
    const now = Date.now();
    const evento = {
      ts: new Date(now).toISOString(), // hora del servidor, no la del navegador
      user: ev.user,
      tipo: ev.tipo,
      frente: txt(ev.frente, 200),
      cambios: Array.isArray(ev.cambios)
        ? ev.cambios.slice(0, 30).map((c) => ({
            campo: txt(c.campo, 60),
            de: txt(c.de, 300),
            a: txt(c.a, 300),
          }))
        : [],
    };
    // Clave = milisegundos (13 dígitos) + sufijo al azar: ordena cronológicamente y no colisiona.
    const key = `${now}_${Math.random().toString(36).slice(2, 8)}`;
    await store.setJSON(key, evento);
    return Response.json({ ok: true });
  }

  if (req.method === "GET") {
    const { blobs } = await store.list();
    const keys = blobs
      .map((b) => b.key)
      .sort()
      .reverse()
      .slice(0, MAX_EVENTOS);
    const eventos = (
      await Promise.all(keys.map((k) => store.get(k, { type: "json" })))
    ).filter(Boolean);
    return Response.json(eventos, { headers: { "Cache-Control": "no-store" } });
  }

  return new Response("Método no permitido", { status: 405 });
};
