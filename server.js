// CodeSera — server.js
// Run: node server.js
// Then open: http://localhost:3000

const http     = require('http');
const fs       = require('fs');
const path     = require('path');
const os       = require('os');

const PORT      = 3000;
const COURSES_DIR = path.join(__dirname, 'courses');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.json': 'application/json',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
};

// Ensure courses directory exists
if (!fs.existsSync(COURSES_DIR)) fs.mkdirSync(COURSES_DIR, { recursive: true });

const server = http.createServer((req, res) => {
  // CORS for localhost LearnForge app
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }


  // ── DELETE /courses/:name — delete a course folder recursively
  if (req.method === 'DELETE' && req.url.startsWith('/courses/')) {
    try {
      const name = decodeURIComponent(req.url.slice('/courses/'.length));
      const safe = path.normalize(name).replace(/^(\.\.([\/\\]|$))+/, '');
      if (!safe || safe.includes('..')) { res.writeHead(400); res.end('Bad path'); return; }
      const dir = path.join(COURSES_DIR, safe);
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch(e) {
      res.writeHead(500); res.end(JSON.stringify({ ok: false, error: e.message }));
    }
    return;
  }

  // ── POST /proxy — CORS proxy for API providers that block browsers
  if (req.method === 'POST' && req.url === '/proxy') {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', async () => {
      try {
        const { url, headers, body: apiBody } = JSON.parse(body);
        if (!url || !url.startsWith('http')) {
          res.writeHead(400); res.end(JSON.stringify({ error: 'Invalid URL' }));
          return;
        }
        // Use Node's built-in fetch (Node 18+)
        const upstream = await fetch(url, {
          method:  'POST',
          headers: headers || {},
          body:    apiBody,
        });
        const text = await upstream.text();
        res.writeHead(upstream.status, {
          'Content-Type': upstream.headers.get('content-type') || 'application/json',
        });
        res.end(text);
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // ── POST /save — save a file to courses/
  if (req.method === 'POST' && req.url === '/save') {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => {
      try {
        const { filepath, content } = JSON.parse(body);
        // filepath must be relative, no traversal
        const safe = path.normalize(filepath).replace(/^(\.\.(\/|\\|$))+/, '');
        const full = path.join(COURSES_DIR, safe);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, content, 'utf8');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, path: safe }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  // ── GET /courses — list all course folders with lesson metadata
  if (req.url === '/courses') {
    try {
      const dirs = fs.readdirSync(COURSES_DIR, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => {
          const courseDir = path.join(COURSES_DIR, d.name);
          const files     = fs.readdirSync(courseDir);
          const lessons   = files
            .filter(f => /^lesson-\d+\.html$/.test(f))
            .sort((a, b) => {
              const na = parseInt(a.match(/\d+/)[0]);
              const nb = parseInt(b.match(/\d+/)[0]);
              return na - nb;
            })
            .map(f => {
              const html = fs.readFileSync(path.join(courseDir, f), 'utf8');
              // Extract title from <title> tag
              const titleMatch = html.match(/<title>([^<]*)<\/title>/i);
              const num = parseInt(f.match(/\d+/)[0]);
              return {
                filename: f,
                lessonNum: num,
                title:    titleMatch ? titleMatch[1].trim() : f,
                html,
              };
            });
          const indexHtml = fs.existsSync(path.join(courseDir, 'index.html'))
            ? fs.readFileSync(path.join(courseDir, 'index.html'), 'utf8')
            : '';
          return { name: d.name, lessons, indexHtml };
        });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(dirs));
    } catch(e) {
      res.writeHead(500); res.end('[]');
    }
    return;
  }

  // ── GET static files ──
  let urlPath = req.url.split('?')[0];
  try { urlPath = decodeURIComponent(urlPath); } catch { /* keep raw */ }
  if (urlPath === '/') urlPath = '/index.html';

  // Strip leading slash for path.join
  const rel = urlPath.replace(/^\//, '');

  // Resolve file: courses/ → lesson/ → public/ → src/ → root
  let filePath = path.join(COURSES_DIR, rel);
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    const idx = path.join(filePath, 'index.html');
    if (fs.existsSync(idx)) {
      filePath = idx;
    } else {
      // lesson assets (lesson.js, lesson-chat.js, lesson.css etc.)
      const lessonPath = path.join(__dirname, 'lesson', rel);
      // public files (index.html, styles.css)
      const publicPath = path.join(__dirname, 'public', rel);
      // src files (app.js, agents.js etc.)
      const srcPath    = path.join(__dirname, 'src', rel);
      // root fallback (sw-scheduler.js, package.json etc.)
      const rootPath   = path.join(__dirname, rel);

      if      (fs.existsSync(lessonPath)) filePath = lessonPath;
      else if (fs.existsSync(publicPath)) filePath = publicPath;
      else if (fs.existsSync(srcPath))    filePath = srcPath;
      else                                filePath = rootPath;
    }
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404); res.end('Not found: ' + rel);
    return;
  }

  const ext  = path.extname(filePath).toLowerCase();
  const mime = MIME[ext] || 'application/octet-stream';

  try {
    const content = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': mime });
    res.end(content);
  } catch(e) {
    res.writeHead(500); res.end(e.message);
  }
});

server.listen(PORT, () => {
  console.log('');
  console.log('  ⬡  CodeSera Server');
  console.log('  ─────────────────────────────');
  console.log(`  App:     http://localhost:${PORT}`);
  console.log(`  Courses: http://localhost:${PORT}/CourseName/index.html`);
  console.log(`  Folder:  ${COURSES_DIR}`);
  console.log('');
  console.log('  Keep this window open while using CodeSera.');
  console.log('  Press Ctrl+C to stop.');
  console.log('');

  // Auto-open browser
  const url = `http://localhost:${PORT}`;
  const cmd = process.platform === 'win32' ? `start ${url}`
            : process.platform === 'darwin' ? `open ${url}`
            : `xdg-open ${url}`;
  require('child_process').exec(cmd);
});
