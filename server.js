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
      ['Susana Gimenez',    'susana@reina.tv',       'Miami',      'Soy famosa y necesito ir',       'B7' ],
      ['El gato de Adorni', 'gato@adorni.gov.ar',    'Nueva York', 'Soy el gato de Adorni',          'C2' ],
      ['Zoe Milei',         'zoe@casarosada.gov.ar', 'Davos',      'Soy la unica hermana que falta', 'D12'],
      ['Nestor Kirchner',   'nestor@eternamente.com','Caracas',    'Costo marginal tambien aplica',  'A9' ],
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
    return res.status(400).json({ error: 'El nombre es obligatorio (minimo 3 caracteres).' });
  if (!email || !validateEmail(email.trim()))
    return res.status(400).json({ error: 'El email no es valido.' });
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
    if (err.code === '23505') return res.status(409).json({ error: 'Ya estas inscripto con ese email. No seas jeta.' });
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
  if (isNaN(id)) return res.status(400).json({ error: 'ID invalido.' });
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

app.get('/admin', function(req, res) {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

app.listen(PORT, () => {
  console.log('Tango 01 corriendo en puerto ' + PORT);
});

module.exports = app;
