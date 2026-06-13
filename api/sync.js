// ============================================================
//  /api/sync — Sincroniza el Mundial 2026 desde football-data.org
//
//  Se ejecuta en el servidor de Vercel, nunca en el navegador,
//  así que las claves secretas no se exponen a nadie.
// ============================================================

const COMPETICION = "WC"; // FIFA World Cup en football-data.org
const THROTTLE_SEGUNDOS = 60; // no llamar a la API más de 1 vez por minuto

export default async function handler(req, res) {
  const SUPA = process.env.SUPABASE_URL;
  const KEY = process.env.SUPABASE_SERVICE_KEY;
  const FD_TOKEN = process.env.FOOTBALL_DATA_TOKEN;

  res.setHeader("Cache-Control", "no-store");

  if (!SUPA || !KEY || !FD_TOKEN) {
    return res.status(500).json({
      ok: false,
      error: "Faltan variables de entorno: SUPABASE_URL, SUPABASE_SERVICE_KEY o FOOTBALL_DATA_TOKEN",
    });
  }

  const headersSupa = {
    apikey: KEY,
    Authorization: `Bearer ${KEY}`,
    "Content-Type": "application/json",
  };

  try {
    // ---- 1. Freno: si hemos sincronizado hace < 60 s, no repetimos ----
    const confResp = await fetch(
      `${SUPA}/rest/v1/config?clave=eq.last_sync&select=valor`,
      { headers: headersSupa }
    );
    const conf = await confResp.json();
    const ultima = conf?.[0]?.valor ? new Date(conf[0].valor) : null;
    const hace = ultima ? (Date.now() - ultima.getTime()) / 1000 : Infinity;

    if (hace < THROTTLE_SEGUNDOS) {
      return res.status(200).json({
        ok: true,
        omitido: true,
        mensaje: `Sincronizado hace ${Math.round(hace)} s; se reutilizan los datos.`,
      });
    }

    // ---- 2. Pedir todos los partidos del Mundial a football-data ----
    const fdResp = await fetch(
      `https://api.football-data.org/v4/competitions/${COMPETICION}/matches`,
      { headers: { "X-Auth-Token": FD_TOKEN } }
    );

    if (!fdResp.ok) {
      const detalle = await fdResp.text();
      return res.status(502).json({
        ok: false,
        error: `football-data.org respondió ${fdResp.status}`,
        detalle: detalle.slice(0, 300),
      });
    }

    const datos = await fdResp.json();
    const partidos = (datos.matches || []).map(mapearPartido).filter(Boolean);

    if (partidos.length === 0) {
      return res.status(200).json({
        ok: true,
        partidos: 0,
        mensaje: "La API no devolvió partidos.",
      });
    }

    // ---- 3. Guardar en Supabase (upsert: crea o actualiza) ----
    const upsert = await fetch(`${SUPA}/rest/v1/partidos`, {
      method: "POST",
      headers: {
        ...headersSupa,
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(partidos),
    });

    if (!upsert.ok) {
      const detalle = await upsert.text();
      return res.status(502).json({
        ok: false,
        error: `Supabase respondió ${upsert.status} al guardar`,
        detalle: detalle.slice(0, 300),
      });
    }

    // ---- 4. Apuntar la hora de esta sincronización ----
    await fetch(`${SUPA}/rest/v1/config`, {
      method: "POST",
      headers: {
        ...headersSupa,
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify([
        { clave: "last_sync", valor: new Date().toISOString() },
      ]),
    });

    return res.status(200).json({ ok: true, partidos: partidos.length, omitido: false });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) });
  }
}

// Convierte un partido de football-data al formato de nuestra tabla
function mapearPartido(m) {
  if (!m || !m.id) return null;
  const grupo = m.group ? m.group.replace("GROUP_", "").replace("Group ", "").trim() : null;

  // ---- NUEVO: Extraer Goles y Cartulinas (Eventos) ----
  let eventos = [];
  
  if (m.goals && Array.isArray(m.goals)) {
    m.goals.forEach(g => {
      eventos.push({ 
        tipo: '⚽', 
        minuto: g.minute, 
        jugador: g.scorer?.name || '?', 
        equipo: g.team?.name 
      });
    });
  }
  
  if (m.bookings && Array.isArray(m.bookings)) {
    m.bookings.forEach(b => {
      let esRoja = (b.card === 'RED' || b.card === 'RED_CARD');
      eventos.push({ 
        tipo: esRoja ? '🟥' : '🟨', 
        minuto: b.minute, 
        jugador: b.player?.name || '?', 
        equipo: b.team?.name 
      });
    });
  }
  
  // Ordenar los eventos por minuto (cronológicamente)
  eventos.sort((a, b) => a.minuto - b.minuto);

  return {
    id: m.id,
    numero: m.matchday ?? null,
    etapa: m.stage || "GROUP_STAGE",
    grupo: grupo,
    local: m.homeTeam?.shortName || m.homeTeam?.name || null,
    visitante: m.awayTeam?.shortName || m.awayTeam?.name || null,
    local_crest: m.homeTeam?.crest || null,
    visitante_crest: m.awayTeam?.crest || null,
    fecha_utc: m.utcDate || null,
    estado: m.status || "TIMED",
    goles_local: m.score?.fullTime?.home ?? null,
    goles_visitante: m.score?.fullTime?.away ?? null,
    eventos: eventos, // <-- Enviamos el JSON con la línea de tiempo a Supabase
    actualizado_en: new Date().toISOString(),
  };
}
