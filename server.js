// ============================================================
// TANGO 01 — LISTA DE ESPERA — Backend
// Node.js + Express + PostgreSQL
// npm install express pg cors
// ============================================================

const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS inscriptos (
      id        SERIAL PRIMARY KEY,
      nombre    TEXT    NOT NULL,
      email     TEXT    NOT NULL UNIQUE,
      destino   TEXT,
      motivo    TEXT,
      butaca    TEXT,
      fecha     TIMESTAMP DEFAULT NOW()
    );
  `);
  const { rows } = await pool.query('SELECT COUNT(*) AS cnt FROM inscriptos');
  if (parseInt(rows[0].cnt) === 0) {
    const seeds = [
      ['Carlos Tevez',      'carlitos@tevez.com',    'Manchester', 'Soy amigo del presidente',       'A3' ],
      ['Susana Giménez',    'susana@reina.tv',       'Miami',      'Soy famosa y necesito ir',       'B7' ],
      ['El gato de Adorni', 'gato@adorni.gov.ar',    'Nueva York', 'Soy el gato de Adorni',          'C2' ],
      ['Zoe Milei',         'zoe@casarosada.gov.ar', 'Davos',      'Soy la única hermana que falta', 'D12'],
      ['Nestor Kirchner',   'nestor@eternamente.com','Caracas',    'Costo marginal también aplica',  'A9' ],
    ];
    for (const s of seeds) {
      await pool.query(
        'INSERT INTO inscriptos (nombre,email,destino,motivo,butaca) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',
        s
      );
    }
  }
}

initDB().then(() => console.log('Base de datos lista')).catch(console.error);

function randomSeat() {
  const r = ['A','B','C','D','E'];
  return r[Math.floor(Math.random() * r.length)] + (Math.floor(Math.random() * 25) + 1);
}

function validateEmail(e) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

function esc(t) {
  return String(t || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── API Routes ───────────────────────────────────────────────

app.get('/api/stats', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT COUNT(*) AS total FROM inscriptos');
    res.json({ total: parseInt(rows[0].total) });
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener stats' });
  }
});

app.get('/api/lista', async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT id, nombre, destino, butaca, TO_CHAR(fecha, 'DD/MM/YYYY HH24:MI') AS fecha FROM inscriptos ORDER BY id DESC LIMIT 50"
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener lista' });
  }
});

app.post('/api/inscribir', async (req, res) => {
  const { nombre, email, destino, motivo } = req.body;
  if (!nombre || nombre.trim().length < 3)
    return res.status(400).json({ error: 'El nombre es obligatorio (mínimo 3 caracteres).' });
  if (!email || !validateEmail(email.trim()))
    return res.status(400).json({ error: 'El email no es válido.' });
  if (nombre.trim().length > 80)
    return res.status(400).json({ error: 'El nombre es demasiado largo.' });
  const butaca = randomSeat();
  try {
    const { rows } = await pool.query(
      'INSERT INTO inscriptos (nombre,email,destino,motivo,butaca) VALUES ($1,$2,$3,$4,$5) RETURNING id,nombre,destino,butaca',
      [nombre.trim(), email.trim().toLowerCase(), (destino||'').trim()||null, (motivo||'').trim()||null, butaca]
    );
    const { rows: cr } = await pool.query('SELECT COUNT(*) AS cnt FROM inscriptos');
    res.status(201).json({ success: true, inscripto: rows[0], total: parseInt(cr[0].cnt) });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Ya estás inscripto con ese email. No seas jeta.' });
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

app.get('/api/admin/lista', async (req, res) => {
  if (req.headers['x-admin-key'] !== process.env.ADMIN_KEY)
    return res.status(401).json({ error: 'Acceso denegado.' });
  try {
    const { rows } = await pool.query(
      "SELECT id,nombre,email,destino,motivo,butaca,TO_CHAR(fecha,'DD/MM/YYYY HH24:MI') AS fecha FROM inscriptos ORDER BY id ASC"
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener lista admin' });
  }
});

app.delete('/api/admin/borrar/:id', async (req, res) => {
  if (req.headers['x-admin-key'] !== process.env.ADMIN_KEY)
    return res.status(401).json({ error: 'Acceso denegado.' });
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido.' });
  try {
    const { rowCount } = await pool.query('DELETE FROM inscriptos WHERE id = $1', [id]);
    if (rowCount === 0) return res.status(404).json({ error: 'No encontrado.' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Error al borrar.' });
  }
});

app.get('/api/admin/export-csv', async (req, res) => {
  if (req.headers['x-admin-key'] !== process.env.ADMIN_KEY)
    return res.status(401).json({ error: 'Acceso denegado.' });
  try {
    const { rows } = await pool.query('SELECT * FROM inscriptos ORDER BY id ASC');
    const headers = ['id','nombre','email','destino','motivo','butaca','fecha'];
    const csv = [
      headers.join(','),
      ...rows.map(r => headers.map(h => '"' + (r[h]||'').toString().replace(/"/g,'""') + '"').join(','))
    ].join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="tango01_inscriptos.csv"');
    res.send('\uFEFF' + csv);
  } catch (err) {
    res.status(500).json({ error: 'Error al exportar CSV' });
  }
});

// ── Admin Panel ──────────────────────────────────────────────

function buildAdminHTML() {
  var css = [
    '* { margin:0; padding:0; box-sizing:border-box; }',
    'body { background:#0a0a0a; color:#fff; font-family:monospace; min-height:100vh; }',
    '.login-wrap { display:flex; align-items:center; justify-content:center; min-height:100vh; padding:20px; }',
    '.login-box { background:#111; border:1px solid rgba(116,172,223,0.3); padding:40px; max-width:360px; width:100%; }',
    '.login-box h1 { font-size:22px; letter-spacing:3px; color:#74ACDF; margin-bottom:6px; }',
    '.login-box p { font-size:12px; color:rgba(255,255,255,0.3); margin-bottom:24px; }',
    'input[type=password] { width:100%; background:#1e1e1e; border:1px solid rgba(255,255,255,0.1); padding:12px; color:#fff; font-size:16px; font-family:monospace; outline:none; margin-bottom:12px; }',
    'input[type=password]:focus { border-color:#74ACDF; }',
    '.btn-login { width:100%; background:#F6B40E; color:#000; border:none; padding:14px; font-size:16px; font-family:monospace; font-weight:bold; letter-spacing:2px; cursor:pointer; }',
    '.btn-login:hover { background:#ffc82e; }',
    '.error { color:#ff6b6b; font-size:12px; margin-bottom:12px; display:none; }',
    '.panel { padding:30px 20px; max-width:1200px; margin:0 auto; }',
    '.panel-header { display:flex; align-items:center; justify-content:space-between; margin-bottom:24px; flex-wrap:wrap; gap:12px; }',
    '.panel-header h1 { font-size:20px; letter-spacing:3px; color:#74ACDF; }',
    '.stats { display:flex; gap:16px; flex-wrap:wrap; margin-bottom:24px; }',
    '.stat-box { background:#111; border:1px solid rgba(116,172,223,0.2); padding:16px 24px; }',
    '.stat-num { font-size:36px; color:#74ACDF; font-weight:bold; }',
    '.stat-label { font-size:11px; color:rgba(255,255,255,0.3); letter-spacing:2px; margin-top:2px; }',
    '.btn-csv { background:#111; color:#F6B40E; border:1px solid #F6B40E; padding:10px 20px; font-family:monospace; font-size:13px; letter-spacing:1px; cursor:pointer; text-decoration:none; display:inline-block; }',
    '.btn-csv:hover { background:#F6B40E; color:#000; }',
    '.btn-logout { background:transparent; color:rgba(255,255,255,0.3); border:1px solid rgba(255,255,255,0.1); padding:10px 16px; font-family:monospace; font-size:12px; cursor:pointer; }',
    '.btn-logout:hover { color:#fff; }',
    'table { width:100%; border-collapse:collapse; font-size:13px; }',
    'th { text-align:left; padding:10px 12px; background:#111; color:rgba(255,255,255,0.4); font-size:10px; letter-spacing:2px; border-bottom:1px solid rgba(255,255,255,0.07); }',
    'td { padding:10px 12px; border-bottom:1px solid rgba(255,255,255,0.05); vertical-align:middle; }',
    'tr:hover td { background:rgba(116,172,223,0.04); }',
    '.id-col { color:rgba(255,255,255,0.2); }',
    '.email-col { color:#74ACDF; }',
    '.butaca-col { color:#F6B40E; }',
    '.fecha-col { color:rgba(255,255,255,0.3); font-size:11px; }',
    '.btn-del { background:transparent; border:1px solid rgba(255,80,80,0.3); color:rgba(255,80,80,0.5); padding:4px 8px; font-family:monospace; font-size:11px; cursor:pointer; }',
    '.btn-del:hover { background:rgba(255,80,80,0.1); border-color:#ff5050; color:#ff5050; }',
    '.btn-ticket { background:transparent; border:1px solid rgba(246,180,14,0.4); color:rgba(246,180,14,0.7); padding:4px 8px; font-family:monospace; font-size:11px; cursor:pointer; margin-right:4px; }',
    '.btn-ticket:hover { background:rgba(246,180,14,0.1); border-color:#F6B40E; color:#F6B40E; }',
    '.search-bar { width:100%; background:#111; border:1px solid rgba(255,255,255,0.1); padding:10px 14px; color:#fff; font-family:monospace; font-size:14px; outline:none; margin-bottom:16px; }',
    '.search-bar:focus { border-color:#74ACDF; }',
    '.no-results { padding:30px; text-align:center; color:rgba(255,255,255,0.2); }',
    '.modal-overlay { display:none; position:fixed; inset:0; background:rgba(0,0,0,0.85); z-index:1000; align-items:center; justify-content:center; padding:20px; }',
    '.modal-overlay.show { display:flex; }',
    '.modal-box { background:#111; border:1px solid rgba(255,255,255,0.15); padding:24px; max-width:540px; width:100%; position:relative; }',
    '.modal-close { position:absolute; top:10px; right:14px; background:transparent; border:none; color:rgba(255,255,255,0.4); font-size:22px; cursor:pointer; }',
    '.modal-close:hover { color:#fff; }',
    '.modal-actions { display:flex; gap:10px; margin-top:16px; justify-content:center; }',
    '.btn-print { background:#F6B40E; color:#000; border:none; padding:10px 28px; font-family:monospace; font-size:14px; font-weight:bold; letter-spacing:2px; cursor:pointer; }',
    '.btn-print:hover { background:#ffc82e; }',
    '#ticket-wrap { background:#fff; color:#000; font-family: "Courier New", monospace; width:100%; }',
    '.tk-header { background:#1a1a2e; color:#fff; padding:14px 18px; display:flex; align-items:center; justify-content:space-between; }',
    '.tk-airline { font-size:10px; letter-spacing:3px; color:rgba(255,255,255,0.5); }',
    '.tk-logo { font-size:20px; font-weight:900; letter-spacing:2px; }',
    '.tk-route { background:#74ACDF; padding:12px 18px; display:flex; align-items:center; justify-content:space-between; }',
    '.tk-city { text-align:center; }',
    '.tk-iata { font-size:30px; font-weight:900; color:#fff; letter-spacing:1px; line-height:1; }',
    '.tk-cityname { font-size:9px; color:rgba(255,255,255,0.75); letter-spacing:2px; margin-top:2px; }',
    '.tk-arrow { font-size:24px; color:rgba(255,255,255,0.6); }',
    '.tk-seat-big { background:#F6B40E; color:#000; font-size:26px; font-weight:900; padding:4px 12px; letter-spacing:1px; }',
    '.tk-body { padding:14px 18px; background:#fff; }',
    '.tk-row { display:flex; border-bottom:1px dashed #ddd; padding:7px 0; }',
    '.tk-row:last-child { border-bottom:none; }',
    '.tk-field { flex:1; }',
    '.tk-label { font-size:8px; letter-spacing:2px; color:#999; text-transform:uppercase; margin-bottom:2px; }',
    '.tk-value { font-size:14px; font-weight:700; color:#1a1a2e; }',
    '.tk-divider { border:none; border-top:2px dashed #bbb; margin:0; }',
    '.tk-footer { background:#f5f5f5; padding:10px 18px; display:flex; align-items:center; justify-content:space-between; }',
    '.tk-barcode { font-size:28px; letter-spacing:-2px; color:#1a1a2e; font-weight:900; }',
    '.tk-disclaimer { font-size:8px; color:#aaa; max-width:180px; text-align:right; line-height:1.4; }',
    '.tk-stamp { display:inline-block; border:3px solid #74ACDF; color:#74ACDF; font-size:9px; letter-spacing:3px; padding:3px 8px; transform:rotate(-8deg); font-weight:900; }'
  ].join('\n');

  var html = '<!DOCTYPE html>\n<html lang="es">\n<head>\n';
  html += '<meta charset="UTF-8">\n';
  html += '<meta name="viewport" content="width=device-width, initial-scale=1.0">\n';
  html += '<title>Admin - Tango 01</title>\n';
  html += '<style>\n' + css + '\n</style>\n</head>\n<body>\n';

  // Login
  html += '<div class="login-wrap" id="login-section">\n';
  html += '  <div class="login-box">\n';
  html += '    <h1>TANGO 01</h1>\n';
  html += '    <p>Panel de administracion - ingresa tu clave</p>\n';
  html += '    <div class="error" id="login-error">Clave incorrecta.</div>\n';
  html += '    <input type="password" id="admin-key-input" placeholder="Clave admin" />\n';
  html += '    <button class="btn-login" id="btn-login">INGRESAR</button>\n';
  html += '  </div>\n</div>\n';

  // Panel
  html += '<div class="panel" id="panel-section" style="display:none">\n';
  html += '  <div class="panel-header">\n';
  html += '    <h1>PANEL ADMIN - TANGO 01</h1>\n';
  html += '    <div style="display:flex;gap:8px">\n';
  html += '      <a class="btn-csv" id="csv-link" href="#">EXPORTAR CSV</a>\n';
  html += '      <button class="btn-logout" id="btn-logout">SALIR</button>\n';
  html += '    </div>\n  </div>\n';
  html += '  <div class="stats">\n';
  html += '    <div class="stat-box"><div class="stat-num" id="stat-total">0</div><div class="stat-label">TOTAL INSCRIPTOS</div></div>\n';
  html += '    <div class="stat-box"><div class="stat-num" id="stat-hoy">0</div><div class="stat-label">HOY</div></div>\n';
  html += '  </div>\n';
  html += '  <input class="search-bar" type="text" id="search-bar" placeholder="Buscar por nombre, email o destino..." />\n';
  html += '  <table id="tabla">\n';
  html += '    <thead><tr><th>#</th><th>NOMBRE</th><th>EMAIL</th><th>DESTINO</th><th>RELACION</th><th>BUTACA</th><th>FECHA</th><th></th></tr></thead>\n';
  html += '    <tbody id="tabla-body"></tbody>\n';
  html += '  </table>\n';
  html += '  <div class="no-results" id="no-results" style="display:none">Sin resultados.</div>\n';
  html += '</div>\n';

  // Modal ticket
  html += '<div class="modal-overlay" id="ticket-modal">\n';
  html += '  <div class="modal-box">\n';
  html += '    <button class="modal-close" id="modal-close">X</button>\n';
  html += '    <div id="ticket-wrap"></div>\n';
  html += '    <div class="modal-actions"><button class="btn-print" id="btn-print">IMPRIMIR / CAPTURAR</button></div>\n';
  html += '  </div>\n</div>\n';

  // Script
  html += '<script>\n';
  html += 'var currentKey = "";\n';
  html += 'var allRows = [];\n';
  html += 'var ticketData = null;\n';

  html += 'document.getElementById("btn-login").onclick = doLogin;\n';
  html += 'document.getElementById("admin-key-input").onkeydown = function(e){ if(e.key==="Enter") doLogin(); };\n';
  html += 'document.getElementById("btn-logout").onclick = doLogout;\n';
  html += 'document.getElementById("search-bar").oninput = function(){ filterTable(this.value); };\n';
  html += 'document.getElementById("modal-close").onclick = function(){ document.getElementById("ticket-modal").classList.remove("show"); };\n';
  html += 'document.getElementById("btn-print").onclick = imprimirTicket;\n';
  html += 'document.getElementById("csv-link").onclick = function(e){ e.preventDefault(); descargarCSV(); };\n';

  html += 'function doLogin(){\n';
  html += '  var key = document.getElementById("admin-key-input").value.trim();\n';
  html += '  if(!key) return;\n';
  html += '  fetch("/api/admin/lista", { headers: { "x-admin-key": key } })\n';
  html += '    .then(function(r){ if(!r.ok) throw new Error(); return r.json(); })\n';
  html += '    .then(function(data){\n';
  html += '      currentKey = key;\n';
  html += '      allRows = data;\n';
  html += '      document.getElementById("login-section").style.display = "none";\n';
  html += '      document.getElementById("panel-section").style.display = "block";\n';
  html += '      renderStats(data);\n';
  html += '      renderTable(data);\n';
  html += '    })\n';
  html += '    .catch(function(){ document.getElementById("login-error").style.display = "block"; });\n';
  html += '}\n';

  html += 'function doLogout(){\n';
  html += '  currentKey = ""; allRows = [];\n';
  html += '  document.getElementById("login-section").style.display = "flex";\n';
  html += '  document.getElementById("panel-section").style.display = "none";\n';
  html += '  document.getElementById("admin-key-input").value = "";\n';
  html += '  document.getElementById("login-error").style.display = "none";\n';
  html += '}\n';

  html += 'function renderStats(data){\n';
  html += '  document.getElementById("stat-total").textContent = data.length;\n';
  html += '  var hoy = new Date().toLocaleDateString("es-AR");\n';
  html += '  var c = data.filter(function(r){ return r.fecha && r.fecha.indexOf(hoy) === 0; }).length;\n';
  html += '  document.getElementById("stat-hoy").textContent = c;\n';
  html += '}\n';

  html += 'function renderTable(data){\n';
  html += '  var tbody = document.getElementById("tabla-body");\n';
  html += '  tbody.innerHTML = "";\n';
  html += '  document.getElementById("no-results").style.display = data.length === 0 ? "block" : "none";\n';
  html += '  data.forEach(function(r){\n';
  html += '    var tr = document.createElement("tr");\n';
  html += '    var td1 = \'<td class="id-col">\' + r.id + \'</td>\';\n';
  html += '    var td2 = \'<td>\' + esc(r.nombre) + \'</td>\';\n';
  html += '    var td3 = \'<td class="email-col">\' + esc(r.email) + \'</td>\';\n';
  html += '    var td4 = \'<td>\' + esc(r.destino || "-") + \'</td>\';\n';
  html += '    var td5 = \'<td>\' + esc(r.motivo || "-") + \'</td>\';\n';
  html += '    var td6 = \'<td class="butaca-col">\' + esc(r.butaca) + \'</td>\';\n';
  html += '    var td7 = \'<td class="fecha-col">\' + esc(r.fecha) + \'</td>\';\n';
  html += '    var td8 = \'<td style="white-space:nowrap"><button class="btn-ticket" data-id="\' + r.id + \'">TICKET</button> <button class="btn-del" data-id="\' + r.id + \'" data-nombre="\' + esc(r.nombre) + \'">BORRAR</button></td>\';\n';
  html += '    tr.innerHTML = td1+td2+td3+td4+td5+td6+td7+td8;\n';
  html += '    tbody.appendChild(tr);\n';
  html += '  });\n';
  html += '  tbody.querySelectorAll(".btn-ticket").forEach(function(btn){\n';
  html += '    btn.onclick = function(){ verTicket(parseInt(this.getAttribute("data-id"))); };\n';
  html += '  });\n';
  html += '  tbody.querySelectorAll(".btn-del").forEach(function(btn){\n';
  html += '    btn.onclick = function(){ borrar(parseInt(this.getAttribute("data-id")), this.getAttribute("data-nombre")); };\n';
  html += '  });\n';
  html += '}\n';

  html += 'function filterTable(q){\n';
  html += '  q = q.toLowerCase();\n';
  html += '  renderTable(allRows.filter(function(r){\n';
  html += '    return (r.nombre||"").toLowerCase().indexOf(q)>=0 ||\n';
  html += '           (r.email||"").toLowerCase().indexOf(q)>=0 ||\n';
  html += '           (r.destino||"").toLowerCase().indexOf(q)>=0 ||\n';
  html += '           (r.motivo||"").toLowerCase().indexOf(q)>=0;\n';
  html += '  }));\n';
  html += '}\n';

  html += 'function borrar(id, nombre){\n';
  html += '  if(!confirm("Borrar a " + nombre + "? Esta accion no se puede deshacer.")) return;\n';
  html += '  fetch("/api/admin/borrar/" + id, { method:"DELETE", headers:{"x-admin-key":currentKey} })\n';
  html += '    .then(function(r){ if(!r.ok) throw new Error(); return r.json(); })\n';
  html += '    .then(function(){\n';
  html += '      allRows = allRows.filter(function(r){ return r.id !== id; });\n';
  html += '      renderStats(allRows);\n';
  html += '      renderTable(allRows);\n';
  html += '    })\n';
  html += '    .catch(function(){ alert("Error al borrar. Intenta de nuevo."); });\n';
  html += '}\n';

  html += 'function toIATA(destino){\n';
  html += '  var map = {"nueva york":"JFK","new york":"JFK","miami":"MIA","madrid":"MAD","barcelona":"BCN","paris":"CDG","london":"LHR","londres":"LHR","roma":"FCO","tokio":"NRT","tokyo":"NRT","dubai":"DXB","cancun":"CUN","mexico":"MEX","bogota":"BOG","lima":"LIM","santiago":"SCL","montevideo":"MVD","rio":"GIG","brasil":"GRU","davos":"ZRH","suiza":"ZRH","washington":"DCA","los angeles":"LAX","chicago":"ORD","las vegas":"LAS","caracas":"CCS","venezuela":"CCS","manchester":"MAN"};\n';
  html += '  if(!destino) return "XCM";\n';
  html += '  var d = destino.toLowerCase();\n';
  html += '  for(var k in map){ if(d.indexOf(k)>=0) return map[k]; }\n';
  html += '  return destino.substring(0,3).toUpperCase();\n';
  html += '}\n';

  html += 'function verTicket(id){\n';
  html += '  var r = allRows.find(function(x){ return x.id===id; });\n';
  html += '  if(!r) return;\n';
  html += '  ticketData = r;\n';
  html += '  var destino = r.destino || "Cualquier lado";\n';
  html += '  var iata = toIATA(destino);\n';
  html += '  var pago = r.motivo ? (r.motivo.length>40 ? r.motivo.substring(0,40)+"..." : r.motivo) : "TOTAL: NO CUESTA NADA";\n';
  html += '  var vuelo = "T01-" + String(r.id).padStart(4,"0");\n';
  html += '  var bars = "||||||||||||||||||||||||||||||||||||||||||||||||||||";\n';
  html += '  var ticket = "";\n';
  html += '  ticket += \'<div class="tk-header">\';\n';
  html += '  ticket += \'<div><div class="tk-airline">REPUBLICA ARGENTINA</div><div class="tk-logo">TANGO 01</div><div class="tk-airline">VUELO PRESIDENCIAL OFICIAL*</div></div>\';\n';
  html += '  ticket += \'<div style="font-size:28px">&#x1F1E6;&#x1F1F7;</div></div>\';\n';
  html += '  ticket += \'<div class="tk-route">\';\n';
  html += '  ticket += \'<div class="tk-city"><div class="tk-iata">EZE</div><div class="tk-cityname">BUENOS AIRES</div></div>\';\n';
  html += '  ticket += \'<div class="tk-arrow">&#x2708;</div>\';\n';
  html += '  ticket += \'<div class="tk-city"><div class="tk-iata">\' + iata + \'</div><div class="tk-cityname">\' + destino.toUpperCase().substring(0,14) + \'</div></div>\';\n';
  html += '  ticket += \'<div style="text-align:right"><div class="tk-seat-big">\' + esc(r.butaca) + \'</div><div style="font-size:9px;color:rgba(255,255,255,0.6);margin-top:4px;letter-spacing:1px">ASIENTO</div></div>\';\n';
  html += '  ticket += \'</div>\';\n';
  html += '  ticket += \'<div class="tk-body">\';\n';
  html += '  ticket += \'<div class="tk-row"><div class="tk-field"><div class="tk-label">PASAJERO</div><div class="tk-value">\' + r.nombre.toUpperCase() + \'</div></div><div class="tk-field" style="text-align:right"><div class="tk-label">VUELO</div><div class="tk-value">\' + vuelo + \'</div></div></div>\';\n';
  html += '  ticket += \'<div class="tk-row"><div class="tk-field"><div class="tk-label">FECHA</div><div class="tk-value">A CONFIRMAR</div></div><div class="tk-field" style="text-align:center"><div class="tk-label">CLASE</div><div class="tk-value">COSTO MARGINAL</div></div><div class="tk-field" style="text-align:right"><div class="tk-label">EMBARQUE</div><div class="tk-value">CUANDO HAYA LUGAR</div></div></div>\';\n';
  html += '  ticket += \'<div class="tk-row"><div class="tk-field"><div class="tk-label">FORMA DE PAGO</div><div class="tk-value" style="font-size:12px">\' + pago.toUpperCase() + \'</div></div><div class="tk-field" style="text-align:right;padding-top:6px"><div class="tk-stamp">LISTA DE ESPERA</div></div></div>\';\n';
  html += '  ticket += \'</div>\';\n';
  html += '  ticket += \'<hr class="tk-divider">\';\n';
  html += '  ticket += \'<div class="tk-footer"><div><div class="tk-barcode">\' + bars + \'</div><div style="font-size:9px;color:#aaa;letter-spacing:1px">\' + vuelo + \' &middot; \' + iata + \' &middot; \' + esc(r.butaca) + \'</div></div><div class="tk-disclaimer">*Este ticket es completamente simbolico. @tucostomarginal</div></div>\';\n';
  html += '  document.getElementById("ticket-wrap").innerHTML = ticket;\n';
  html += '  document.getElementById("ticket-modal").classList.add("show");\n';
  html += '}\n';

  html += 'function descargarCSV(){\n';
  html += '  fetch("/api/admin/export-csv", { headers:{"x-admin-key":currentKey} })\n';
  html += '    .then(function(r){ return r.blob(); })\n';
  html += '    .then(function(blob){\n';
  html += '      var a = document.createElement("a");\n';
  html += '      a.href = URL.createObjectURL(blob);\n';
  html += '      a.download = "tango01_inscriptos.csv";\n';
  html += '      a.click();\n';
  html += '    });\n';
  html += '}\n';

  html += 'function imprimirTicket(){\n';
  html += '  var contenido = document.getElementById("ticket-wrap").innerHTML;\n';
  html += '  var estilos = document.querySelector("style").innerHTML;\n';
  html += '  var win = window.open("","_blank","width=600,height=500");\n';
  html += '  win.document.write("<!DOCTYPE html><html><head><meta charset=UTF-8><title>Ticket Tango 01</title><style>" + estilos + " body{background:#fff;display:flex;justify-content:center;padding:20px;} #ticket-wrap{max-width:520px;width:100%;} @media print{body{padding:0;}}</style></head><body><div id=ticket-wrap>" + contenido + "</div><script>window.onload=function(){window.print();}<\/script></body></html>");\n';
  html += '  win.document.close();\n';
  html += '}\n';

  html += 'function esc(t){\n';
  html += '  return String(t||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");\n';
  html += '}\n';

  html += '</script>\n</body>\n</html>\n';
  return html;
}

app.get('/admin', function(req, res) {
  res.send(buildAdminHTML());
});

app.listen(PORT, () => {
  console.log('Tango 01 corriendo en puerto ' + PORT);
});

module.exports = app;
