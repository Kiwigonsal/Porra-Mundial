// ============================================================
//  /api/sync — Sincroniza usando API-FOOTBALL (Free Tier)
// ============================================================

const COMPETICION = 1; // ID 1 = World Cup
const TEMPORADA = 2026;
const THROTTLE_SEGUNDOS = 300; // Bloqueo de 5 minutos

module.exports = async function(req, res) {
  // Claves hardcodeadas para evitar errores de entorno
  const SUPA = "https://aazygqkknksqnksyzhtq.supabase.co";
  const KEY = process.env.SUPABASE_SERVICE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFhenlncWtrbmtzcW5rc3l6aHRxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEyODU0NTQsImV4cCI6MjA5Njg2MTQ1NH0.EUn5OtrZMB_rhFcSpvXuCRTQGGiiirPMzCfX-Neuw-E";
  const API_KEY = process.env.API_FOOTBALL_KEY;

  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json");
  
  if (!API_KEY) {
      return res.status(200).json({ ok: false, error: "Falta API_FOOTBALL_KEY en Vercel." });
  }

  const headersSupa = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

  try {
    // 1. Control de llamadas (Evitar pasarse de 100/día)
    const confResp = await fetch(`${SUPA}/rest/v1/config?clave=eq.last_sync&select=valor`, { headers: headersSupa });
    const conf = await confResp.json();
    const ultima = (conf && conf[0] && conf[0].valor) ? new Date(conf[0].valor) : null;
    const hace = ultima ? (Date.now() - ultima.getTime()) / 1000 : Infinity;

    if (hace < THROTTLE_SEGUNDOS) {
      return res.status(200).json({ ok: true, omitido: true, error: `Espera ${Math.round(THROTTLE_SEGUNDOS - hace)}s para no gastar tokens.` });
    }

    // 2. Pedir datos a API-FOOTBALL
    const afResp = await fetch(`https://v3.football.api-sports.io/fixtures?league=${COMPETICION}&season=${TEMPORADA}`, { 
      headers: { "x-apisports-key": API_KEY } 
    });

    if (!afResp.ok) return res.status(200).json({ ok: false, error: `API-Football rechazada: Error ${afResp.status}` });
    
    const datos = await afResp.json();
    
    if (datos.errors && Object.keys(datos.errors).length > 0) {
        return res.status(200).json({ ok: false, error: "API-Football dice: " + JSON.stringify(datos.errors) });
    }

    if (!datos.response || datos.response.length === 0) {
        return res.status(200).json({ ok: true, partidos: 0, error: "No hay partidos en la API." });
    }

    const partidos = datos.response.map(mapearPartidoAF).filter(Boolean);

    // 3. Subir a Supabase
    const upsert = await fetch(`${SUPA}/rest/v1/partidos`, {
      method: "POST",
      headers: { ...headersSupa, Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(partidos),
    });

    if (!upsert.ok) {
        const errTxt = await upsert.text();
        return res.status(200).json({ ok: false, error: `Error BD Partidos: ${upsert.status} - ${errTxt}` });
    }

    // 4. Renovar Marca de Tiempo
    const confUpsert = await fetch(`${SUPA}/rest/v1/config`, {
      method: "POST",
      headers: { ...headersSupa, Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify([{ clave: "last_sync", valor: new Date().toISOString() }]),
    });
    
    if (!confUpsert.ok) {
        const errTxt = await confUpsert.text();
        return res.status(200).json({ ok: false, error: `Error BD Config: ${confUpsert.status} - ${errTxt}` });
    }

    return res.status(200).json({ ok: true, partidos: partidos.length });
  } catch (err) {
    return res.status(200).json({ ok: false, error: String(err) });
  }
}

function mapearPartidoAF(m) {
  if (!m.fixture || !m.fixture.id) return null;
  const fix = m.fixture;
  const status = fix.status.short;

  let estado = "TIMED";
  if (["1H", "2H", "HT", "ET", "BT", "P", "LIVE"].includes(status)) estado = "IN_PLAY";
  if (["FT", "AET", "PEN"].includes(status)) estado = "FINISHED";
  if (["SUSP", "INT", "PST", "CANC", "ABD", "AWD", "WO"].includes(status)) estado = "PAUSED";

  let eventos = [];
  if (m.events && Array.isArray(m.events)) {
    m.events.forEach(e => {
       let icono = "⏱";
       let txtJugador = e.player?.name || "?";
       
       if (e.type === "Goal") {
           icono = "⚽";
           if(e.detail === "Penalty") icono = "⚽ (P)";
           if(e.detail === "Own Goal") icono = "⚽ (AG)";
           if(e.assist?.name) txtJugador += ` (A: ${e.assist.name})`;
       }
       if (e.type === "Card") icono = e.detail.includes("Red") ? "🟥" : "🟨";
       if (e.type === "subst") {
           icono = "🔄";
           txtJugador = `${e.assist?.name || "?"} ⬆️ ${e.player?.name || "?"} ⬇️`;
       }
       if (e.type === "Var") {
           icono = "📺";
           txtJugador += ` (${e.detail})`;
       }
       
       eventos.push({
           minuto: e.time.elapsed + (e.time.extra ? `+${e.time.extra}` : ""),
           tipo: icono,
           jugador: txtJugador,
           equipo: e.team?.name || ""
       });
    });
  }

  let etapa = m.league.round || "GROUP_STAGE";
  let grupo = null;
  if (etapa.includes("Group")) {
      grupo = etapa.split("-")[1]?.trim() || etapa.replace("Group", "").trim().charAt(0);
      etapa = "GROUP_STAGE";
  }

  return {
    id: fix.id,
    etapa: etapa,
    grupo: grupo,
    local: m.teams.home.name,
    visitante: m.teams.away.name,
    local_crest: m.teams.home.logo,
    visitante_crest: m.teams.away.logo,
    fecha_utc: fix.date,
    estado: estado,
    goles_local: m.goals.home,
    goles_visitante: m.goals.away,
    eventos: eventos,
    actualizado_en: new Date().toISOString()
  };
}
