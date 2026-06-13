// ============================================================
//  /api/sync — Sincroniza usando API-FOOTBALL (Free Tier)
//  Se ejecuta cada 5 minutos (100 llamadas al día = ok)
// ============================================================

const COMPETICION = 1; // ID 1 = World Cup
const TEMPORADA = 2026;
const THROTTLE_SEGUNDOS = 300; // Bloqueo de 5 minutos exactos

export default async function handler(req, res) {
  const SUPA = process.env.SUPABASE_URL;
  const KEY = process.env.SUPABASE_SERVICE_KEY;
  const API_KEY = process.env.API_FOOTBALL_KEY || process.env.FOOTBALL_DATA_TOKEN;

  res.setHeader("Cache-Control", "no-store");
  if (!SUPA || !KEY || !API_KEY) return res.status(500).json({ ok: false, error: "Faltan variables de entorno." });

  const headersSupa = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

  try {
    // 1. Control de llamadas (Evitar pasarse de 100/día)
    const confResp = await fetch(`${SUPA}/rest/v1/config?clave=eq.last_sync&select=valor`, { headers: headersSupa });
    const conf = await confResp.json();
    const ultima = conf?.[0]?.valor ? new Date(conf[0].valor) : null;
    const hace = ultima ? (Date.now() - ultima.getTime()) / 1000 : Infinity;

    if (hace < THROTTLE_SEGUNDOS) {
      return res.status(200).json({ ok: true, omitido: true, mensaje: `Sincronizado hace ${Math.round(hace)}s.` });
    }

    // 2. Pedir datos a API-FOOTBALL
    const afResp = await fetch(`https://v3.football.api-sports.io/fixtures?league=${COMPETICION}&season=${TEMPORADA}`, { 
      headers: { "x-apisports-key": API_KEY } 
    });

    if (!afResp.ok) return res.status(502).json({ ok: false, error: `API respondió ${afResp.status}` });
    const datos = await afResp.json();
    if (!datos.response || datos.response.length === 0) return res.status(200).json({ ok: true, partidos: 0, mensaje: "No hay partidos en la API." });

    const partidos = datos.response.map(mapearPartidoAF).filter(Boolean);

    // 3. Subir a Supabase
    const upsert = await fetch(`${SUPA}/rest/v1/partidos`, {
      method: "POST",
      headers: { ...headersSupa, Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(partidos),
    });

    if (!upsert.ok) return res.status(502).json({ ok: false, error: `Supabase respondió ${upsert.status}` });

    // 4. Renovar Marca de Tiempo
    await fetch(`${SUPA}/rest/v1/config`, {
      method: "POST",
      headers: { ...headersSupa, Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify([{ clave: "last_sync", valor: new Date().toISOString() }]),
    });

    return res.status(200).json({ ok: true, partidos: partidos.length, omitido: false });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) });
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
