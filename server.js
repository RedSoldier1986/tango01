// ============================================================
// TANGO 01 — LISTA DE ESPERA — Backend
// Node.js + Express + SQLite
// npm install express better-sqlite3 cors
// ============================================================

const express = require('express');
const Database = require('better-sqlite3');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || './tango01.db';

// ── Middleware ──────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'))); // put index.html here

// ── Database ────────────────────────────────────────────────
const db = new Database(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS inscriptos (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre      TEXT    NOT NULL,
    email       TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    destino     TEXT,
    motivo      TEXT,
    butaca      TEXT,
    fecha       TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
  );
`);

// Seed con algunos datos graciosos de ejemplo
const countRow = db.prepare('SELECT COUNT(*) AS cnt FROM inscriptos').get();
if (countRow.cnt === 0) {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO inscriptos (nombre, email, destino, motivo, butaca)
    VALUES (@nombre, @email, @destino, @motivo, @butaca)
  `);
  const seeds = [
    { nombre: 'Carlos Tevez',        email: 'carlitos@tevez.com',     destino: 'Manchester',  motivo: 'Soy amigo del presidente',       butaca: 'A3'  },
    { nombre: 'Susana Giménez',      email: 'susana@reina.tv',        destino: 'Miami',       motivo: 'Soy famosa y necesito ir',       butaca: 'B7'  },
    { nombre: 'El gato de Adorni',   email: 'gato@adorni.gov.ar',     destino: 'Nueva York',  motivo: 'Soy el gato de Adorni',          butaca: 'C2'  },
    { nombre: 'Zoe Milei',           email: 'zoe@casarosada.gov.ar',  destino: 'Davos',       motivo: 'Soy la única hermana que falta', butaca: 'D12' },
    { nombre: 'Nestor Kirchner',     email: 'nestor@eternamente.com', destino: 'Caracas',     motivo: 'Costo marginal también aplica',  butaca: 'A9'  },
  ];
  seeds.forEach(s => insert.run(s));
}

// ── Helper ──────────────────────────────────────────────────
function randomSeat() {
  const rows = ['A','B','C','D','E'];
  return rows[Math.floor(Math.random() * rows.length)] + (Math.floor(Math.random() * 25) + 1);
}

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ── Routes ──────────────────────────────────────────────────

// GET /api/stats — total inscriptos (sin exponer emails)
app.get('/api/stats', (req, res) => {
  const row = db.prepare('SELECT COUNT(*) AS total FROM inscriptos').get();
  res.json({ total: row.total });
});

// GET /api/lista — lista pública (sin emails)
app.get('/api/lista', (req, res) => {
  const rows = db.prepare(`
    SELECT id, nombre, destino, butaca, fecha
    FROM inscriptos
    ORDER BY id DESC
    LIMIT 50
  `).all();
  res.json(rows);
});

// POST /api/inscribir — nueva inscripción
app.post('/api/inscribir', (req, res) => {
  const { nombre, email, destino, motivo } = req.body;

  // Validations
  if (!nombre || nombre.trim().length < 3) {
    return res.status(400).json({ error: 'El nombre es obligatorio (mínimo 3 caracteres).' });
  }
  if (!email || !validateEmail(email.trim())) {
    return res.status(400).json({ error: 'El email no es válido.' });
  }
  if (nombre.trim().length > 80) {
    return res.status(400).json({ error: 'El nombre es demasiado largo.' });
  }

  const butaca = randomSeat();

  try {
    const stmt = db.prepare(`
      INSERT INTO inscriptos (nombre, email, destino, motivo, butaca)
      VALUES (?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      nombre.trim(),
      email.trim().toLowerCase(),
      (destino || '').trim() || null,
      (motivo || '').trim() || null,
      butaca
    );

    const newRow = db.prepare('SELECT id, nombre, destino, butaca, fecha FROM inscriptos WHERE id = ?').get(result.lastInsertRowid);
    const total = db.prepare('SELECT COUNT(*) AS cnt FROM inscriptos').get().cnt;

    res.status(201).json({
      success: true,
      inscripto: newRow,
      total,
      message: '¡Inscripto! Esperá el llamado.'
    });

  } catch (err) {
    if (err.message.includes('UNIQUE constraint')) {
      return res.status(409).json({ error: 'Ya estás inscripto con ese email. No seas jeta.' });
    }
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor. El Tango 01 está en mantenimiento.' });
  }
});

// GET /api/admin/lista — lista completa con emails (proteger con auth en producción)
app.get('/api/admin/lista', (req, res) => {
  const adminKey = req.headers['x-admin-key'];
  if (!adminKey || adminKey !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: 'Acceso denegado.' });
  }
  const rows = db.prepare('SELECT * FROM inscriptos ORDER BY id ASC').all();
  res.json(rows);
});

// GET /api/admin/export-csv — exportar CSV
app.get('/api/admin/export-csv', (req, res) => {
  const adminKey = req.headers['x-admin-key'];
  if (!adminKey || adminKey !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: 'Acceso denegado.' });
  }
  const rows = db.prepare('SELECT * FROM inscriptos ORDER BY id ASC').all();
  const headers = ['id', 'nombre', 'email', 'destino', 'motivo', 'butaca', 'fecha'];
  const csv = [
    headers.join(','),
    ...rows.map(r => headers.map(h => `"${(r[h] || '').toString().replace(/"/g, '""')}"`).join(','))
  ].join('\n');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="tango01_inscriptos.csv"');
  res.send('\uFEFF' + csv); // BOM for Excel compatibility
});

// ── Catch-all (SPA) ─────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Start ────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n✈  TANGO 01 — Lista de espera corriendo en http://localhost:${PORT}`);
  console.log(`📊 Base de datos: ${DB_PATH}`);
  console.log(`🔐 Admin key: ${process.env.ADMIN_KEY || '(no configurada — seteá ADMIN_KEY en .env)'}\n`);
});

module.exports = app;
