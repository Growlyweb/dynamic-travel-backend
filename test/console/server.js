// Serves the browser test console (test/console/index.html) for manual testing.
// Usage: npm run console   ->   http://localhost:5173
//
// 5173 is the default CLIENT_URL, so the API's CORS allow-list already accepts this page and the
// refresh-token cookie behaves like it would for a real frontend. Development tool only:
// it binds to localhost and serves nothing but the one HTML file.
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.TEST_CONSOLE_PORT) || 5173;
const FILE = path.join(__dirname, 'index.html');

http
  .createServer((req, res) => {
    const pathname = req.url.split('?')[0];
    if (pathname !== '/' && pathname !== '/index.html') {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    fs.createReadStream(FILE).pipe(res);
  })
  .listen(PORT, '127.0.0.1', () => {
    console.log(`Test console: http://localhost:${PORT}`);
    console.log('The API must be running too (npm run dev), and its CLIENT_URL must include this address.');
  });
