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

// ── Middleware ──────────────────────────────────────────────
app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Database ────────────────────────────────────────────────
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
      { nombre: 'Carlos Tevez',       email: 'carlitos@tevez.com',    destino: 'Manchester', motivo: 'Soy amigo del presidente',       butaca: 'A3'  },
      { nombre: 'Susana Giménez',     email: 'susana@reina.tv',       destino: 'Miami',      motivo: 'Soy famosa y necesito ir',       butaca: 'B7'  },
      { nombre: 'El gato de Adorni',  email: 'gato@adorni.gov.ar',    destino: 'Nueva York', motivo: 'Soy el gato de Adorni',          butaca: 'C2'  },
      { nombre: 'Zoe Milei',          email: 'zoe@casarosada.gov.ar', destino: 'Davos',      motivo: 'Soy la única hermana que falta', butaca: 'D12' },
      { nombre: 'Nestor Kirchner',    email: 'nestor@eternamente.com',destino: 'Caracas',    motivo: 'Costo marginal también aplica',  butaca: 'A9'  },
    ];
    for (const s of seeds) {
      await pool.query(
        'INSERT INTO inscriptos (nombre, email, destino, motivo, butaca) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',
        [s.nombre, s.email, s.destino, s.motivo, s.butaca]
      );
    }
  }
}

initDB().then(() => console.log('✅ Base de datos lista')).catch(console.error);

// ── Helpers ─────────────────────────────────────────────────
function randomSeat() {
  const rows = ['A','B','C','D','E'];
  return rows[Math.floor(Math.random() * rows.length)] + (Math.floor(Math.random() * 25) + 1);
}

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ── Routes ──────────────────────────────────────────────────

// GET /api/stats
app.get('/api/stats', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT COUNT(*) AS total FROM inscriptos');
    res.json({ total: parseInt(rows[0].total) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener stats' });
  }
});

// GET /api/lista — lista pública sin emails
app.get('/api/lista', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT id, nombre, destino, butaca, TO_CHAR(fecha, 'DD/MM/YYYY HH24:MI') AS fecha
      FROM inscriptos ORDER BY id DESC LIMIT 50
    `);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener lista' });
  }
});

// POST /api/inscribir
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
      `INSERT INTO inscriptos (nombre, email, destino, motivo, butaca)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, nombre, destino, butaca`,
      [
        nombre.trim(),
        email.trim().toLowerCase(),
        (destino || '').trim() || null,
        (motivo || '').trim() || null,
        butaca
      ]
    );
    const { rows: countRows } = await pool.query('SELECT COUNT(*) AS cnt FROM inscriptos');
    res.status(201).json({
      success: true,
      inscripto: rows[0],
      total: parseInt(countRows[0].cnt),
      message: '¡Inscripto! Esperá el llamado.'
    });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Ya estás inscripto con ese email. No seas jeta.' });
    }
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

// GET /api/admin/lista
app.get('/api/admin/lista', async (req, res) => {
  if (req.headers['x-admin-key'] !== process.env.ADMIN_KEY)
    return res.status(401).json({ error: 'Acceso denegado.' });
  try {
    const { rows } = await pool.query(`
      SELECT id, nombre, email, destino, motivo, butaca,
             TO_CHAR(fecha, 'DD/MM/YYYY HH24:MI') AS fecha
      FROM inscriptos ORDER BY id ASC
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener lista admin' });
  }
});

// GET /api/admin/export-csv
app.get('/api/admin/export-csv', async (req, res) => {
  if (req.headers['x-admin-key'] !== process.env.ADMIN_KEY)
    return res.status(401).json({ error: 'Acceso denegado.' });
  try {
    const { rows } = await pool.query('SELECT * FROM inscriptos ORDER BY id ASC');
    const headers = ['id','nombre','email','destino','motivo','butaca','fecha'];
    const csv = [
      headers.join(','),
      ...rows.map(r => headers.map(h => `"${(r[h]||'').toString().replace(/"/g,'""')}"`).join(','))
    ].join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="tango01_inscriptos.csv"');
    res.send('\uFEFF' + csv);
  } catch (err) {
    res.status(500).json({ error: 'Error al exportar CSV' });
  }
});

// DELETE /api/admin/borrar/:id
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
    console.error(err);
    res.status(500).json({ error: 'Error al borrar.' });
  }
});

// GET /admin — panel web
app.get('/admin', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Admin — Tango 01</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { background:#0a0a0a; color:#fff; font-family: monospace; min-height:100vh; }
  .login-wrap { display:flex; align-items:center; justify-content:center; min-height:100vh; padding:20px; }
  .login-box { background:#111; border:1px solid rgba(116,172,223,0.3); padding:40px; max-width:360px; width:100%; }
  .login-box h1 { font-size:22px; letter-spacing:3px; color:#74ACDF; margin-bottom:6px; }
  .login-box p { font-size:12px; color:rgba(255,255,255,0.3); margin-bottom:24px; }
  input[type=password] { width:100%; background:#1e1e1e; border:1px solid rgba(255,255,255,0.1); padding:12px; color:#fff; font-size:16px; font-family:monospace; outline:none; margin-bottom:12px; }
  input[type=password]:focus { border-color:#74ACDF; }
  button { width:100%; background:#F6B40E; color:#000; border:none; padding:14px; font-size:16px; font-family:monospace; font-weight:bold; letter-spacing:2px; cursor:pointer; }
  button:hover { background:#ffc82e; }
  .error { color:#ff6b6b; font-size:12px; margin-bottom:12px; display:none; }
  .panel { padding:30px 20px; max-width:1100px; margin:0 auto; }
  .panel-header { display:flex; align-items:center; justify-content:space-between; margin-bottom:24px; flex-wrap:wrap; gap:12px; }
  .panel-header h1 { font-size:20px; letter-spacing:3px; color:#74ACDF; }
  .stats { display:flex; gap:16px; flex-wrap:wrap; margin-bottom:24px; }
  .stat-box { background:#111; border:1px solid rgba(116,172,223,0.2); padding:16px 24px; }
  .stat-num { font-size:36px; color:#74ACDF; font-weight:bold; }
  .stat-label { font-size:11px; color:rgba(255,255,255,0.3); letter-spacing:2px; margin-top:2px; }
  .btn-csv { background:#111; color:#F6B40E; border:1px solid #F6B40E; padding:10px 20px; font-family:monospace; font-size:13px; letter-spacing:1px; cursor:pointer; text-decoration:none; display:inline-block; }
  .btn-csv:hover { background:#F6B40E; color:#000; }
  .btn-logout { background:transparent; color:rgba(255,255,255,0.3); border:1px solid rgba(255,255,255,0.1); padding:10px 16px; font-family:monospace; font-size:12px; cursor:pointer; }
  .btn-logout:hover { color:#fff; }
  table { width:100%; border-collapse:collapse; font-size:13px; }
  th { text-align:left; padding:10px 12px; background:#111; color:rgba(255,255,255,0.4); font-size:10px; letter-spacing:2px; border-bottom:1px solid rgba(255,255,255,0.07); }
  .btn-del { background:transparent; border:1px solid rgba(255,80,80,0.3); color:rgba(255,80,80,0.5); padding:4px 10px; font-family:monospace; font-size:11px; cursor:pointer; border-radius:2px; }
  .btn-del:hover { background:rgba(255,80,80,0.1); border-color:#ff5050; color:#ff5050; }
  .btn-ticket { background:transparent; border:1px solid rgba(246,180,14,0.4); color:rgba(246,180,14,0.7); padding:4px 10px; font-family:monospace; font-size:11px; cursor:pointer; border-radius:2px; margin-right:4px; }
  .btn-ticket:hover { background:rgba(246,180,14,0.1); border-color:#F6B40E; color:#F6B40E; }

  /* MODAL */
  .modal-overlay { display:none; position:fixed; inset:0; background:rgba(0,0,0,0.85); z-index:1000; align-items:center; justify-content:center; padding:20px; }
  .modal-overlay.show { display:flex; }
  .modal-box { background:#0a0a0a; border:1px solid rgba(255,255,255,0.1); padding:24px; max-width:520px; width:100%; position:relative; }
  .modal-close { position:absolute; top:12px; right:14px; background:transparent; border:none; color:rgba(255,255,255,0.3); font-size:20px; cursor:pointer; width:auto; padding:0; }
  .modal-close:hover { color:#fff; background:transparent; }
  .modal-actions { display:flex; gap:10px; margin-top:16px; justify-content:center; }
  .btn-print { background:#F6B40E; color:#000; border:none; padding:10px 24px; font-family:monospace; font-size:14px; font-weight:bold; letter-spacing:2px; cursor:pointer; width:auto; }
  .btn-print:hover { background:#ffc82e; }

  /* E-TICKET */
  #ticket-render {
    background:#fff;
    color:#000;
    font-family: 'Courier New', Courier, monospace;
    width:100%;
    padding:0;
    user-select:none;
  }
  .tk-header {
    background:#1a1a2e;
    color:#fff;
    padding:16px 20px;
    display:flex;
    align-items:center;
    justify-content:space-between;
  }
  .tk-airline { font-size:11px; letter-spacing:3px; color:rgba(255,255,255,0.5); }
  .tk-logo { font-size:22px; font-weight:900; letter-spacing:2px; color:#fff; }
  .tk-flag { font-size:28px; }
  .tk-route {
    background:#74ACDF;
    padding:14px 20px;
    display:flex;
    align-items:center;
    justify-content:space-between;
    gap:8px;
  }
  .tk-city { text-align:center; }
  .tk-iata { font-size:32px; font-weight:900; color:#fff; letter-spacing:1px; line-height:1; }
  .tk-cityname { font-size:10px; color:rgba(255,255,255,0.7); letter-spacing:2px; margin-top:2px; }
  .tk-arrow { font-size:28px; color:rgba(255,255,255,0.6); }
  .tk-body { padding:16px 20px; background:#fff; }
  .tk-row { display:flex; gap:0; border-bottom:1px dashed #ddd; padding:8px 0; }
  .tk-row:last-child { border-bottom:none; }
  .tk-field { flex:1; }
  .tk-label { font-size:8px; letter-spacing:2px; color:#999; text-transform:uppercase; margin-bottom:2px; }
  .tk-value { font-size:15px; font-weight:700; color:#1a1a2e; letter-spacing:0.5px; }
  .tk-divider {
    border:none;
    border-top: 2px dashed #ccc;
    margin:0;
    position:relative;
  }
  .tk-divider::before {
    content:'✂';
    position:absolute;
    left:-8px;
    top:-10px;
    color:#ccc;
    font-size:14px;
  }
  .tk-footer {
    background:#f5f5f5;
    padding:10px 20px;
    display:flex;
    align-items:center;
    justify-content:space-between;
  }
  .tk-barcode { font-size:32px; letter-spacing:-2px; color:#1a1a2e; font-weight:900; }
  .tk-disclaimer { font-size:8px; color:#aaa; max-width:200px; text-align:right; line-height:1.4; }
  .tk-seat-big {
    background:#F6B40E;
    color:#000;
    font-size:28px;
    font-weight:900;
    padding:4px 14px;
    letter-spacing:1px;
  }
  .tk-stamp {
    display:inline-block;
    border:3px solid #74ACDF;
    color:#74ACDF;
    font-size:10px;
    letter-spacing:3px;
    padding:4px 10px;
    transform:rotate(-8deg);
    font-weight:900;
  }
  td { padding:10px 12px; border-bottom:1px solid rgba(255,255,255,0.05); vertical-align:top; }
  tr:hover td { background:rgba(116,172,223,0.04); }
  .id-col { color:rgba(255,255,255,0.2); }
  .email-col { color:#74ACDF; }
  .butaca-col { color:#F6B40E; }
  .fecha-col { color:rgba(255,255,255,0.3); font-size:11px; }
  .search-bar { width:100%; background:#111; border:1px solid rgba(255,255,255,0.1); padding:10px 14px; color:#fff; font-family:monospace; font-size:14px; outline:none; margin-bottom:16px; }
  .search-bar:focus { border-color:#74ACDF; }
  .no-results { padding:30px; text-align:center; color:rgba(255,255,255,0.2); }
</style>
</head>
<body>
<div class="login-wrap" id="login-section">
  <div class="login-box">
    <h1>✈ TANGO 01</h1>
    <p>Panel de administración — ingresá tu clave</p>
    <div class="error" id="login-error">Clave incorrecta.</div>
    <input type="password" id="admin-key-input" placeholder="Clave admin" onkeydown="if(event.key==='Enter')doLogin()" />
    <button onclick="doLogin()">INGRESAR</button>
  </div>
</div>
<div class="panel" id="panel-section" style="display:none">
  <div class="panel-header">
    <h1>✈ PANEL ADMIN — TANGO 01</h1>
    <div style="display:flex;gap:8px">
      <a class="btn-csv" id="csv-link" href="#">⬇ EXPORTAR CSV</a>
      <button class="btn-logout" onclick="doLogout()">SALIR</button>
    </div>
  </div>
  <div class="stats">
    <div class="stat-box">
      <div class="stat-num" id="stat-total">—</div>
      <div class="stat-label">TOTAL INSCRIPTOS</div>
    </div>
    <div class="stat-box">
      <div class="stat-num" id="stat-hoy">—</div>
      <div class="stat-label">HOY</div>
    </div>
  </div>
  <input class="search-bar" type="text" placeholder="Buscar por nombre, email o destino..." oninput="filterTable(this.value)" />
  <table id="tabla">
    <thead>
      <tr>
        <th>#</th><th>NOMBRE</th><th>EMAIL</th><th>DESTINO</th><th>RELACIÓN</th><th>BUTACA</th><th>FECHA</th><th></th>
      </tr>
    </thead>
    <tbody id="tabla-body"></tbody>
  </table>
  <div class="no-results" id="no-results" style="display:none">Sin resultados.</div>
</div>

<!-- TICKET MODAL -->
<div class="modal-overlay" id="ticket-modal">
  <div class="modal-box">
    <button class="modal-close" onclick="cerrarTicket()">✕</button>
    <div id="ticket-render"></div>
    <div class="modal-actions">
      <button class="btn-print" onclick="imprimirTicket()">📸 CAPTURAR / IMPRIMIR</button>
    </div>
  </div>
</div>
<script>
  let currentKey = '';
  let allRows = [];

  function doLogin() {
    const key = document.getElementById('admin-key-input').value.trim();
    if (!key) return;
    fetch('/api/admin/lista', { headers: { 'x-admin-key': key } })
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(data => {
        currentKey = key;
        allRows = data;
        document.getElementById('login-section').style.display = 'none';
        document.getElementById('panel-section').style.display = 'block';
        document.getElementById('csv-link').onclick = function(e) {
          e.preventDefault();
          fetch('/api/admin/export-csv', { headers: { 'x-admin-key': currentKey } })
            .then(r => r.blob()).then(blob => {
              const a = document.createElement('a');
              a.href = URL.createObjectURL(blob);
              a.download = 'tango01_inscriptos.csv';
              a.click();
            });
        };
        renderStats(data);
        renderTable(data);
      })
      .catch(() => { document.getElementById('login-error').style.display = 'block'; });
  }

  function doLogout() {
    currentKey = ''; allRows = [];
    document.getElementById('login-section').style.display = 'flex';
    document.getElementById('panel-section').style.display = 'none';
    document.getElementById('admin-key-input').value = '';
    document.getElementById('login-error').style.display = 'none';
  }

  function renderStats(data) {
    document.getElementById('stat-total').textContent = data.length;
    const hoy = new Date().toLocaleDateString('es-AR');
    const hoyCount = data.filter(r => r.fecha && r.fecha.startsWith(hoy)).length;
    document.getElementById('stat-hoy').textContent = hoyCount;
  }

  function renderTable(data) {
    const tbody = document.getElementById('tabla-body');
    tbody.innerHTML = '';
    document.getElementById('no-results').style.display = data.length === 0 ? 'block' : 'none';
    data.forEach(r => {
      const tr = document.createElement('tr');
      tr.innerHTML = \`<td class="id-col">\${r.id}</td><td>\${esc(r.nombre)}</td><td class="email-col">\${esc(r.email)}</td><td>\${esc(r.destino||'—')}</td><td>\${esc(r.motivo||'—')}</td><td class="butaca-col">\${esc(r.butaca)}</td><td class="fecha-col">\${esc(r.fecha)}</td><td style="white-space:nowrap"><button class="btn-ticket" onclick="verTicket(\${r.id})">🎫 TICKET</button><button class="btn-del" onclick="borrar(\${r.id}, '\${esc(r.nombre)}')">✕ BORRAR</button></td>\`;
      tbody.appendChild(tr);
    });
  }

  function filterTable(q) {
    q = q.toLowerCase();
    renderTable(allRows.filter(r =>
      (r.nombre||'').toLowerCase().includes(q) ||
      (r.email||'').toLowerCase().includes(q) ||
      (r.destino||'').toLowerCase().includes(q) ||
      (r.motivo||'').toLowerCase().includes(q)
    ));
  }

  function toIATA(destino) {
    const map = {
      'nueva york':'JFK','new york':'JFK','york':'JFK',
      'miami':'MIA','miami beach':'MIA',
      'madrid':'MAD','barcelona':'BCN','españa':'MAD',
      'paris':'CDG','france':'CDG','francia':'CDG',
      'london':'LHR','londres':'LHR',
      'roma':'FCO','rome':'FCO','italia':'FCO',
      'tokio':'NRT','tokyo':'NRT','japon':'NRT',
      'dubai':'DXB','abu dhabi':'AUH',
      'cancun':'CUN','mexico':'MEX','ciudad de mexico':'MEX',
      'bogota':'BOG','colombia':'BOG',
      'lima':'LIM','peru':'LIM',
      'santiago':'SCL','chile':'SCL',
      'montevideo':'MVD','uruguay':'MVD',
      'rio':'GIG','rio de janeiro':'GIG','brasil':'GRU','san pablo':'GRU',
      'davos':'ZRH','suiza':'ZRH','ginebra':'GVA',
      'washington':'DCA','los angeles':'LAX','chicago':'ORD',
      'las vegas':'LAS','houston':'IAH','dallas':'DFW',
      'caracas':'CCS','venezuela':'CCS',
      'la habana':'HAV','cuba':'HAV',
      'beijing':'PEK','china':'PEK','shanghai':'PVG',
      'moscu':'SVO','rusia':'SVO',
      'manchester':'MAN','liverpool':'LPL',
    };
    if (!destino) return 'XCM';
    const d = destino.toLowerCase();
    for (const k in map) { if (d.includes(k)) return map[k]; }
    return destino.substring(0,3).toUpperCase();
  }

  function verTicket(id) {
    const r = allRows.find(x => x.id === id);
    if (!r) return;

    const destino = r.destino || 'Cualquier lado';
    const iata = toIATA(destino);
    const pago = r.motivo
      ? r.motivo.length > 40 ? r.motivo.substring(0,40)+'...' : r.motivo
      : 'TOTAL: NO CUESTA NADA';
    const fechaVuelo = 'A CONFIRMAR';
    const vuelo = 'T01-' + String(r.id).padStart(4,'0');
    const barcodeChars = '|||||||||||||||||||||||||||||||||||||||||||||||||||||';

    document.getElementById('ticket-render').innerHTML = \`
      <div id="ticket-render">
        <div class="tk-header">
          <div>
            <div class="tk-airline">REPÚBLICA ARGENTINA</div>
            <div class="tk-logo">✈ TANGO 01</div>
            <div class="tk-airline" style="margin-top:2px">VUELO PRESIDENCIAL OFICIAL*</div>
          </div>
          <div class="tk-flag">🇦🇷</div>
        </div>

        <div class="tk-route">
          <div class="tk-city">
            <div class="tk-iata">EZE</div>
            <div class="tk-cityname">BUENOS AIRES</div>
          </div>
          <div class="tk-arrow">✈</div>
          <div class="tk-city">
            <div class="tk-iata">\${iata}</div>
            <div class="tk-cityname">\${destino.toUpperCase().substring(0,14)}</div>
          </div>
          <div style="text-align:right">
            <div class="tk-seat-big">\${r.butaca}</div>
            <div style="font-size:9px;color:rgba(255,255,255,0.6);margin-top:4px;letter-spacing:1px">ASIENTO</div>
          </div>
        </div>

        <div class="tk-body">
          <div class="tk-row">
            <div class="tk-field">
              <div class="tk-label">PASAJERO</div>
              <div class="tk-value">\${r.nombre.toUpperCase()}</div>
            </div>
            <div class="tk-field" style="text-align:right">
              <div class="tk-label">VUELO</div>
              <div class="tk-value">\${vuelo}</div>
            </div>
          </div>
          <div class="tk-row">
            <div class="tk-field">
              <div class="tk-label">FECHA</div>
              <div class="tk-value">\${fechaVuelo}</div>
            </div>
            <div class="tk-field" style="text-align:center">
              <div class="tk-label">CLASE</div>
              <div class="tk-value">COSTO MARGINAL</div>
            </div>
            <div class="tk-field" style="text-align:right">
              <div class="tk-label">EMBARQUE</div>
              <div class="tk-value">CUANDO HAYA LUGAR</div>
            </div>
          </div>
          <div class="tk-row">
            <div class="tk-field">
              <div class="tk-label">FORMA DE PAGO</div>
              <div class="tk-value" style="font-size:13px">\${pago.toUpperCase()}</div>
            </div>
            <div class="tk-field" style="text-align:right;padding-top:4px">
              <div class="tk-stamp">LISTA DE ESPERA</div>
            </div>
          </div>
        </div>

        <hr class="tk-divider">

        <div class="tk-footer">
          <div>
            <div class="tk-barcode">\${barcodeChars}</div>
            <div style="font-size:9px;color:#aaa;letter-spacing:1px">\${vuelo} · \${iata} · \${r.butaca}</div>
          </div>
          <div class="tk-disclaimer">
            *Este ticket es completamente simbólico. El Estado no se hace responsable de esperanzas incumplidas. @tucostomarginal
          </div>
        </div>
      </div>
    \`;

    document.getElementById('ticket-modal').classList.add('show');
  }

  function cerrarTicket() {
    document.getElementById('ticket-modal').classList.remove('show');
  }

  function imprimirTicket() {
    const contenido = document.getElementById('ticket-render').outerHTML;
    const ventana = window.open('', '_blank', 'width=600,height=500');
    ventana.document.write(\`
      <!DOCTYPE html><html><head>
      <meta charset="UTF-8">
      <title>E-Ticket Tango 01</title>
      <style>
        * { margin:0; padding:0; box-sizing:border-box; }
        body { background:#fff; display:flex; justify-content:center; padding:20px; }
        .tk-header { background:#1a1a2e; color:#fff; padding:16px 20px; display:flex; align-items:center; justify-content:space-between; }
        .tk-airline { font-size:11px; letter-spacing:3px; color:rgba(255,255,255,0.5); font-family:monospace; }
        .tk-logo { font-size:22px; font-weight:900; letter-spacing:2px; color:#fff; font-family:monospace; }
        .tk-flag { font-size:28px; }
        .tk-route { background:#74ACDF; padding:14px 20px; display:flex; align-items:center; justify-content:space-between; gap:8px; font-family:monospace; }
        .tk-city { text-align:center; }
        .tk-iata { font-size:32px; font-weight:900; color:#fff; letter-spacing:1px; line-height:1; }
        .tk-cityname { font-size:10px; color:rgba(255,255,255,0.7); letter-spacing:2px; margin-top:2px; }
        .tk-arrow { font-size:28px; color:rgba(255,255,255,0.6); }
        .tk-body { padding:16px 20px; background:#fff; font-family:monospace; }
        .tk-row { display:flex; gap:0; border-bottom:1px dashed #ddd; padding:8px 0; }
        .tk-row:last-child { border-bottom:none; }
        .tk-field { flex:1; }
        .tk-label { font-size:8px; letter-spacing:2px; color:#999; text-transform:uppercase; margin-bottom:2px; }
        .tk-value { font-size:15px; font-weight:700; color:#1a1a2e; letter-spacing:0.5px; }
        .tk-divider { border:none; border-top:2px dashed #ccc; margin:0; position:relative; }
        .tk-divider::before { content:'✂'; position:absolute; left:-8px; top:-10px; color:#ccc; font-size:14px; }
        .tk-footer { background:#f5f5f5; padding:10px 20px; display:flex; align-items:center; justify-content:space-between; font-family:monospace; }
        .tk-barcode { font-size:32px; letter-spacing:-2px; color:#1a1a2e; font-weight:900; }
        .tk-disclaimer { font-size:8px; color:#aaa; max-width:200px; text-align:right; line-height:1.4; }
        .tk-seat-big { background:#F6B40E; color:#000; font-size:28px; font-weight:900; padding:4px 14px; letter-spacing:1px; }
        .tk-stamp { display:inline-block; border:3px solid #74ACDF; color:#74ACDF; font-size:10px; letter-spacing:3px; padding:4px 10px; transform:rotate(-8deg); font-weight:900; font-family:monospace; }
        #ticket-render { max-width:520px; width:100%; }
        @media print { body { padding:0; } }
      </style>
      </head><body>\${contenido}<script>window.onload=()=>window.print()<\/script></body></html>
    \`);
    ventana.document.close();
  }
    if (!confirm('¿Borrar a ' + nombre + '? Esta acción no se puede deshacer.')) return;
    fetch('/api/admin/borrar/' + id, {
      method: 'DELETE',
      headers: { 'x-admin-key': currentKey }
    })
    .then(r => { if (!r.ok) throw new Error(); return r.json(); })
    .then(() => {
      allRows = allRows.filter(r => r.id !== id);
      renderStats(allRows);
      renderTable(allRows);
    })
    .catch(() => alert('Error al borrar. Intentá de nuevo.'));
  }

  function esc(t) {
    return String(t||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }
</script>
</body>
</html>`);
});

// ── Start ────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n✈  TANGO 01 corriendo en puerto ${PORT}`);
});

module.exports = app;
