✈ TANGO 01 — QUIERO SER EL PRÓXIMO COSTO MARGINAL
Lista de espera satírica — Instrucciones de deployment
---
Estructura del proyecto
```
tango01/
├── public/
│   └── index.html        ← El frontend (ya incluye todo: HTML, CSS, JS)
├── server.js             ← Backend Node.js + SQLite
├── package.json
├── .env                  ← Variables de entorno (crear manualmente)
└── tango01.db            ← Se crea automáticamente al arrancar
```
---
Instalación local
```bash
# 1. Crear la carpeta del proyecto
mkdir tango01 && cd tango01

# 2. Copiar server.js acá y crear la carpeta public/
mkdir public
# Copiar index.html dentro de public/

# 3. Inicializar e instalar dependencias
npm init -y
npm install express better-sqlite3 cors

# 4. Crear archivo .env
echo "PORT=3000" > .env
echo "ADMIN_KEY=tu-clave-secreta-aqui" >> .env
echo "DB_PATH=./tango01.db" >> .env

# 5. Correr el servidor
node server.js
```
Abrí http://localhost:3000
---
Endpoints de la API
Método	Ruta	Descripción
GET	`/api/stats`	Total de inscriptos
GET	`/api/lista`	Lista pública (sin emails)
POST	`/api/inscribir`	Registrar nuevo inscripto
GET	`/api/admin/lista`	Lista completa con emails (requiere header `x-admin-key`)
GET	`/api/admin/export-csv`	Exportar CSV completo
POST /api/inscribir — Body JSON
```json
{
  "nombre": "Juan Pérez",
  "email": "juan@ejemplo.com",
  "destino": "Nueva York",
  "motivo": "Amigo de un amigo de un funcionario"
}
```
Admin endpoints — Header requerido
```
x-admin-key: tu-clave-secreta-aqui
```
---
Conectar el frontend al backend
En `index.html`, modificar la función `handleSubmit()` para llamar a la API en lugar de usar localStorage:
```javascript
// Reemplazar saveInscriptos(list) por:
const response = await fetch('/api/inscribir', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ nombre, email, destino, motivo })
});
const data = await response.json();
if (!response.ok) {
  alert(data.error);
  return;
}
// Actualizar counter con data.total
```
Y `getInscriptos()` por:
```javascript
const res = await fetch('/api/lista');
const data = await res.json();
// usar data para renderList()
```
---
Deployment en producción
Opción A: Railway (recomendado, gratis)
Crear cuenta en https://railway.app
Crear nuevo proyecto → Deploy from GitHub
Setear variables de entorno: `ADMIN_KEY`, `PORT`
Railway detecta Node.js automáticamente
Opción B: Render
https://render.com → New Web Service
Conectar repo de GitHub
Build command: `npm install`
Start command: `node server.js`
Opción C: VPS (DigitalOcean, Linode, etc.)
```bash
# Con PM2 para que no muera
npm install -g pm2
pm2 start server.js --name tango01
pm2 startup
pm2 save
```
---
Exportar la base de datos (para análisis)
```bash
# Exportar CSV via API
curl -H "x-admin-key: tu-clave-secreta" \
  https://tudominio.com/api/admin/export-csv \
  -o inscriptos.csv

# O directamente con SQLite
sqlite3 tango01.db ".mode csv" ".headers on" "SELECT * FROM inscriptos;" > export.csv
```
---
Personalización
Cambiar el nombre del sitio: Buscar `TANGO 01` en index.html
Modificar los datos de ejemplo (seeds): Ver el bloque `seeds` en server.js
Agregar más campos: Añadir columna en el `CREATE TABLE` y en el formulario
Dominio sugerido: `costomarginal.com.ar`, `tango01.com.ar`, `butacalibre.ar`
---
Este proyecto es completamente satírico. No tiene afiliación con el Estado argentino.
