#!/usr/bin/env node

/**
 * MULE SHIELD Single-Command Application Launcher
 * Starts Python backend, verifies health, starts frontend server, and opens browser.
 */

const { spawn, exec } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const BACKEND_PORT = process.env.BACKEND_PORT || 8000;
const FRONTEND_PORT = process.env.FRONTEND_PORT || 3000;
const ROOT_DIR = path.resolve(__dirname, '..');

console.log('====================================================');
console.log('           🛡️  MULE SHIELD SYSTEM LAUNCHER           ');
console.log('   Multi-Agent Financial Intelligence & Mule Detection');
console.log('====================================================\n');

// 1. Detect Python executable
function getPythonExecutable() {
  const isWin = process.platform === 'win32';
  const venvPython = isWin
    ? path.join(ROOT_DIR, 'venv', 'Scripts', 'python.exe')
    : path.join(ROOT_DIR, 'venv', 'bin', 'python');

  if (fs.existsSync(venvPython)) {
    return venvPython;
  }
  return isWin ? 'python' : 'python3';
}

const pythonCmd = getPythonExecutable();
console.log(`[1/5] Using Python runtime: ${pythonCmd}`);

// 2. Start Python analytical backend (or reuse existing)
let backendProcess = null;

function startBackendIfNeeded(callback) {
  const req = http.get({
    hostname: '127.0.0.1',
    port: BACKEND_PORT,
    path: '/api/health',
    timeout: 800
  }, (res) => {
    if (res.statusCode === 200) {
      console.log(`[2/5] Python Analytical Engine is already running on port ${BACKEND_PORT}.`);
      return callback();
    }
    spawnBackend(callback);
  });
  req.on('error', () => spawnBackend(callback));
  req.on('timeout', () => {
    req.destroy();
    spawnBackend(callback);
  });
}

function spawnBackend(callback) {
  console.log(`[2/5] Starting Python Analytical Engine on port ${BACKEND_PORT}...`);
  backendProcess = spawn(pythonCmd, ['backend/main.py'], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      PORT: String(BACKEND_PORT),
      HOST: '127.0.0.1'
    },
    stdio: 'inherit'
  });

  backendProcess.on('error', (err) => {
    console.warn(`[Backend Notice] Python background runner: ${err.message}`);
  });

  backendProcess.on('exit', (code) => {
    if (code && code !== 0) {
      console.warn(`[Backend Notice] Analytical process exited with code ${code}.`);
    }
  });

  callback();
}

startBackendIfNeeded(() => {
// 3. Start lightweight Node.js HTTP Server for Frontend
console.log(`[3/5] Starting Frontend Server on port ${FRONTEND_PORT}...`);

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  // Proxy API requests to backend
  if (req.url.startsWith('/api/')) {
    const proxyReq = http.request({
      hostname: '127.0.0.1',
      port: BACKEND_PORT,
      path: req.url,
      method: req.method,
      headers: {
        ...req.headers,
        host: `127.0.0.1:${BACKEND_PORT}`,
        'x-forwarded-host': req.headers.host || '',
        'x-forwarded-proto': req.headers['x-forwarded-proto'] || (req.socket.encrypted ? 'https' : 'http'),
        'x-forwarded-for': req.headers['x-forwarded-for'] || req.socket.remoteAddress || ''
      }
    }, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    });

    proxyReq.on('error', () => {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Backend Analytical Engine initializing or unavailable.' }));
    });

    req.pipe(proxyReq);
    return;
  }

  // Serve static files
  let safePath = req.url.split('?')[0];
  if (safePath === '/' || safePath === '') safePath = '/index.html';

  let filePath = path.join(ROOT_DIR, safePath);
  if (!fs.existsSync(filePath)) {
    filePath = path.join(ROOT_DIR, 'frontend', safePath);
  }
  if (!fs.existsSync(filePath)) {
    filePath = path.join(ROOT_DIR, 'public', safePath);
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
  } else {
    // Fallback to index.html
    const indexPath = path.join(ROOT_DIR, 'index.html');
    if (fs.existsSync(indexPath)) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      fs.createReadStream(indexPath).pipe(res);
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
    }
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.warn(`\n[Notice] Port ${FRONTEND_PORT} is already in use by an existing MULE SHIELD instance.`);
    console.log(`[4/5] Active frontend accessible at: http://localhost:${FRONTEND_PORT}`);
    console.log(`[5/5] Launching MULE SHIELD in browser...\n`);
    const url = `http://localhost:${FRONTEND_PORT}`;
    const startCmd = process.platform === 'win32' ? `start ${url}` :
                     process.platform === 'darwin' ? `open ${url}` : `xdg-open ${url}`;
    exec(startCmd, () => {});
    console.log('====================================================');
    console.log('  MULE SHIELD is already running!');
    console.log(`  Frontend: http://localhost:${FRONTEND_PORT}`);
    console.log(`  Backend:  http://127.0.0.1:${BACKEND_PORT}`);
    console.log('  Existing instance remains active.');
    console.log('====================================================');
    process.exit(0);
  } else {
    console.error(`Frontend server error: ${err.message}`);
    process.exit(1);
  }
});

server.listen(FRONTEND_PORT, () => {
  console.log(`[4/5] Frontend accessible at: http://localhost:${FRONTEND_PORT}`);
  console.log(`[5/5] Launching MULE SHIELD in browser...\n`);

  const url = `http://localhost:${FRONTEND_PORT}`;
  const startCmd = process.platform === 'win32' ? `start ${url}` :
                   process.platform === 'darwin' ? `open ${url}` : `xdg-open ${url}`;
  exec(startCmd, () => {});

  console.log('====================================================');
  console.log('  MULE SHIELD is running!');
  console.log(`  Frontend: http://localhost:${FRONTEND_PORT}`);
  console.log(`  Backend:  http://127.0.0.1:${BACKEND_PORT}`);
  console.log('  Press Ctrl+C to terminate all services.');
  console.log('====================================================');
});

// Clean shutdown
function cleanup() {
  console.log('\nShutting down MULE SHIELD services...');
  server.close();
  if (backendProcess) {
    try {
      backendProcess.kill('SIGINT');
    } catch (e) {}
  }
  process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
});
