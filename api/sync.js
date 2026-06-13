// ============================================================
//  /api/sync — Sincroniza usando FOOTBALL-DATA.ORG (100% Gratis)
// ============================================================

const THROTTLE_SEGUNDOS = 60; // Espera de 1 minuto entre llamadas

module.exports = async function(req, res) {
  const SUPA = "https://aazygqkknksqnksyzhtq.supabase.co";
  const KEY = process.env.SUPABASE_SERVICE_KEY;
  const API_KEY = process.env.FOOTBALL_DATA_TOKEN; // Usamos el token antiguo

  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json");
  
  if (!API_KEY) {
      return res.status(200).json({ ok: false, error: "Falta FOOTBALL_DATA_TOKEN en Vercel." });
  }

  const headersSupa = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

  try {
    const confResp = await fetch(`${SUPA}/rest/v1/config?clave=eq.last_sync&select=valor`, { headers: headersSupa });
    const conf = await confResp.json();
    const ultima = (conf && conf[0] && conf[0].valor) ? new Date(conf[0].valor) : null;
    const hace = ultima ? (Date.now() - ultima.getTime()) / 1000 : Infinity;

    if (hace < THROTTLE_SEGUNDOS) {
      return res.status(200).json({ ok: true, omitido: true, error: `Espera ${Math.round(THROTTLE_SEGUNDOS - hace)}s.` });
    }

    // Llamada a Football-Data.org (WC = World Cup)
    const fdResp = await fetch(`https://api.football-data.org/v4/competitions/WC/matches`, { 
      headers: { "X-Auth-Token": API_KEY } 
    });

    if (!fdResp.ok) {
        const errTxt = await fdResp.text();
        return res.status(200).json({ ok: false, error: `Error Football-Data: ${fdResp.status} - ${errTxt}` });
    }
    
    const datos = await fdResp.json();

    if (!datos.matches || datos.matches.length === 0) {
        return res.status(200).json({ ok: true, partidos: 0, error: "No hay partidos en la API." });
    }

    const partidos = datos.matches.map(mapearPartidoFD).filter(Boolean);

    // Subir a Supabase
    const upsert = await fetch(`${SUPA}/rest/v1/partidos`, {
      method: "POST",
      headers: { ...headersSupa, Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(partidos),
    });

    if (!upsert.ok) {
        const errTxt = await upsert.text();
        return res.status(200).json({ ok: false, error: `Error BD Partidos: ${upsert.status} - ${errTxt}` });
    }

    // Renovar Marca de Tiempo
    await fetch(`${SUPA}/rest/v1/config`, {
      method: "POST",
      headers: { ...headersSupa, Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify([{ clave: "last_sync", valor: new Date().toISOString() }]),
    });

    return res.status(200).json({ ok: true, partidos: partidos.length });
  } catch (err) {
    return res.status(200).json({ ok: false, error: String(err) });
  }
}

function mapearPartidoFD(m) {
  if (!m || !m.id) return null;
  
  let estado = m.status;
  if (["IN_PLAY", "PAUSED"].includes(estado)) estado = "IN_PLAY";
  
  let gl = null, gv = null;
  if (m.score && m.score.fullTime) {
      gl = m.score.fullTime.home ?? null;
      gv = m.score.fullTime.away ?? null;
  }

  // Football-Data procesa eventos de forma más sencilla (no tiene VAR ni Subs detalladas)
  let eventos = [];
  
  return {
    id: m.id,
    etapa: m.stage,
    grupo: m.group ? m.group.replace('GROUP_', '') : null,
    local: m.homeTeam?.tla || m.homeTeam?.name || "?",
    visitante: m.awayTeam?.tla || m.awayTeam?.name || "?",
    local_crest: m.homeTeam?.crest,
    visitante_crest: m.awayTeam?.crest,
    fecha_utc: m.utcDate,
    estado: estado,
    goles_local: gl,
    goles_visitante: gv,
    eventos: eventos,
    actualizado_en: new Date().toISOString()
  };
}
