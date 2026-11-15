// A tiny static file server for the game folder, used by the playtest and the sprite tool. Loading images needs
// http:// (browsers block file:// images from WebGL), and it's how GitHub Pages serves the game anyway.
const http = require('http');
const fs = require('fs');
const path = require('path');

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.json': 'application/json', '.md': 'text/markdown' };

// Serves `root` on a free local port; resolves to { url, close }.
function serve(root) {
  root = path.resolve(root);
  const server = http.createServer((req, res) => {
    const file = path.join(root, decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
    if (!file.startsWith(root)) return res.writeHead(403).end();
    fs.readFile(file, (err, data) => {
      if (err) return res.writeHead(404).end();
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' }).end(data);
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => server.close(),
  })));
}

module.exports = { serve };
