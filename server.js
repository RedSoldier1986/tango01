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
        <th>#</th><th>NOMBRE</th><th>EMAIL</th><th>DESTINO</th><th>RELACIÓN</th><th>BUTACA</th><th>FECHA</th>
      </tr>
    </thead>
    <tbody id="tabla-body"></tbody>
  </table>
  <div class="no-results" id="no-results" style="display:none">Sin resultados.</div>
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
      tr.innerHTML = \`<td class="id-col">\${r.id}</td><td>\${esc(r.nombre)}</td><td class="email-col">\${esc(r.email)}</td><td>\${esc(r.destino||'—')}</td><td>\${esc(r.motivo||'—')}</td><td class="butaca-col">\${esc(r.butaca)}</td><td class="fecha-col">\${esc(r.fecha)}</td>\`;
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
