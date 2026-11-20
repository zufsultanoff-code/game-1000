// Simple static server: node serve.js  -> http://localhost:8080 (also reachable from iPhone on the same Wi-Fi)
var http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
var root = __dirname, port = process.env.PORT || 8080;
var types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
http.createServer(function (req, res) {
  var p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  var f = path.join(root, path.normalize(p));
  if (f.indexOf(root) !== 0) { res.writeHead(403); return res.end(); }
  fs.readFile(f, function (err, data) {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}).listen(port, function () {
  console.log('Local:   http://localhost:' + port);
  var nets = os.networkInterfaces();
  Object.keys(nets).forEach(function (k) {
    nets[k].forEach(function (n) { if (n.family === 'IPv4' && !n.internal) console.log('Network: http://' + n.address + ':' + port); });
  });
});
