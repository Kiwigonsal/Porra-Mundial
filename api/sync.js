// ============================================================
//  /api/sync — Sincroniza usando FOOTBALL-DATA.ORG
// ============================================================

const THROTTLE_SEGUNDOS = 60; 

module.exports = async function(req, res) {
  const SUPA = "https://aazygqkknksqnksyzhtq.supabase.co";
  const KEY = process.env.SUPABASE_SERVICE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFhenlncWtrbmtzcW5rc3l6aHRxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEyODU0NTQsImV4cCI6MjA5Njg2MTQ1NH0.EUn5OtrZMB_rhFcSpvXuCRTQGGiiirPMzCfX-Neuw-E";
  const API_KEY = process.env.FOOTBALL_DATA_TOKEN;

  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json");
  
  if (!API_KEY) return res.status(200).json({ ok: false, error: "Falta FOOTBALL_DATA_TOKEN" });

  const headersSupa = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

  try {
    const confResp = await fetch(`${SUPA}/rest/v1/config?clave=eq.last_sync&select=valor`, { headers: headersSupa });
    const conf = await confResp.json();
    const ultima = (conf && conf[0] && conf[0].valor) ? new Date(conf[0].valor) : null;
    const hace = ultima ? (Date.now() - ultima.getTime()) / 1000 : Infinity;

    if (hace < THROTTLE_SEGUNDOS) {
      return res.status(200).json({ ok: true, omitido: true, error: `Pausa de seguridad` });
    }

    const fdResp = await fetch(`https://api.football-data.org/v4/competitions/WC/matches`, { 
      headers: { "X-Auth-Token": API_KEY } 
    });

    if (!fdResp.ok) {
        return res.status(200).json({ ok: false, error: `Error API externa: ${fdResp.status}` });
    }
    
    const datos = await fdResp.json();
    if (!datos.matches || datos.matches.length === 0) {
        return res.status(200).json({ ok: true, partidos: 0 });
    }

    const bloqueadosResp = await fetch(`${SUPA}/rest/v1/partidos?bloqueo_admin=eq.true&select=id`, { headers: headersSupa });
    let idsBloqueados = [];
    if (bloqueadosResp.ok) {
        const bloqueadosData = await bloqueadosResp.json();
        idsBloqueados = bloqueadosData.map(b => b.id);
    }

    const partidos = datos.matches
      .map(mapearPartidoFD)
      .filter(Boolean)
      .filter(p => !idsBloqueados.includes(p.id)); 

    if (partidos.length > 0) {
        await fetch(`${SUPA}/rest/v1/partidos`, {
          method: "POST",
          headers: { ...headersSupa, Prefer: "resolution=merge-duplicates,return=minimal" },
          body: JSON.stringify(partidos),
        });
    }

    await fetch(`${SUPA}/rest/v1/config`, {
      method: "POST",
      headers: { ...headersSupa, Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify([{ clave: "last_sync", valor: new Date().toISOString() }]),
    });

    // Limpieza de chat segura (48h)
    try {
        const limiteHoras = new Date(Date.now() - 172800000).toISOString();
        await fetch(`${SUPA}/rest/v1/comentarios?creado_en=lt.${limiteHoras}`, {
          method: 'DELETE',
          headers: headersSupa
        });
    } catch(errChat) { console.log("Error limpiando chat", errChat); }

    return res.status(200).json({ ok: true, partidos: partidos.length });
  } catch (err) {
    return res.status(200).json({ ok: false, error: String(err) });
  }
}

function mapearPartidoFD(m) {
  if (!m || !m.id) return null;
  let estado = m.status;
  if (["IN_PLAY", "PAUSED"].includes(estado)) estado = "IN_PLAY";
  if (["FINISHED", "AWARDED"].includes(estado)) estado = "FINISHED";
  
  const horaPartido = new Date(m.utcDate).getTime();
  const ahora = Date.now();
  if (estado === "TIMED" || estado === "SCHEDULED") {
      if (ahora >= horaPartido && ahora < horaPartido + (150 * 60000)) estado = "IN_PLAY";
  }
  
  let gl = null, gv = null;
  if (m.score && m.score.fullTime) {
      if (m.score.fullTime.home !== null) gl = m.score.fullTime.home;
      if (m.score.fullTime.away !== null) gv = m.score.fullTime.away;
  }
  return {
    id: m.id, etapa: m.stage || "GROUP_STAGE", grupo: m.group ? m.group.replace('GROUP_', '') : null,
    local: m.homeTeam?.tla || m.homeTeam?.name || "?", visitante: m.awayTeam?.tla || m.awayTeam?.name || "?",
    local_crest: m.homeTeam?.crest, visitante_crest: m.awayTeam?.crest,
    fecha_utc: m.utcDate, estado: estado, goles_local: gl, goles_visitante: gv,
    eventos: '[]', actualizado_en: new Date().toISOString()
  };
}
