// Static server and Windows app launcher for Thousand (1000).
// Supports `--no-open` to run the server without launching a browser window.
var http = require('http');
var fs = require('fs');
var path = require('path');
var os = require('os');
var childProcess = require('child_process');

var root = path.resolve(__dirname);
var startPort = Number(process.env.PORT) || 8080;
var noOpen = process.argv.indexOf('--no-open') !== -1;

var TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json; charset=utf-8'
};

function findAvailablePort(port, cb) {
  var probe = http.createServer();
  probe.once('error', function () {
    findAvailablePort(port + 1, cb);
  });
  probe.listen(port, function () {
    probe.close(function () {
      cb(port);
    });
  });
}

function findBrowser() {
  var localAppData = process.env.LOCALAPPDATA || '';
  var programFiles = process.env.ProgramFiles || 'C:\\Program Files';
  var programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  var candidates = [
    path.join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(localAppData, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe')
  ];
  for (var i = 0; i < candidates.length; i++) {
    if (candidates[i] && fs.existsSync(candidates[i])) return candidates[i];
  }
  return null;
}

function openDefaultBrowser(url) {
  childProcess.exec('start "" "' + url + '"');
}

function handleRequest(req, res) {
  var reqPath;
  try {
    reqPath = decodeURIComponent((req.url || '/').split('?')[0]);
  } catch (e) {
    res.writeHead(400);
    return res.end('Bad request');
  }
  if (reqPath === '/' || reqPath === '') reqPath = '/index.html';

  var rel = reqPath.replace(/^[/\\]+/, '');
  var filePath = path.resolve(root, rel);
  if (filePath !== root && filePath.indexOf(root + path.sep) !== 0) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  fs.readFile(filePath, function (err, data) {
    if (err) {
      res.writeHead(404);
      return res.end('Not found');
    }
    var ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': TYPES[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(data);
  });
}

function launchApp(port, server) {
  var gameUrl = 'http://127.0.0.1:' + port + '/index.html';
  var browserExe = findBrowser();
  if (!browserExe) {
    openDefaultBrowser(gameUrl);
    return;
  }

  var profileDir = path.join(process.env.LOCALAPPDATA || root, 'Thousand1000_AppData');
  try {
    if (!fs.existsSync(profileDir)) fs.mkdirSync(profileDir, { recursive: true });
  } catch (e) {}

  var browserProcess = childProcess.spawn(browserExe, [
    '--app=' + gameUrl,
    '--user-data-dir=' + profileDir,
    '--window-size=520,900'
  ], {
    detached: false,
    stdio: 'ignore'
  });

  browserProcess.on('error', function () {
    openDefaultBrowser(gameUrl);
  });

  browserProcess.on('exit', function () {
    server.close();
    process.exit(0);
  });
}

findAvailablePort(startPort, function (port) {
  var server = http.createServer(handleRequest);
  server.listen(port, function () {
    console.log('Local:   http://localhost:' + port);
    var nets = os.networkInterfaces();
    Object.keys(nets).forEach(function (k) {
      nets[k].forEach(function (n) {
        if (n.family === 'IPv4' && !n.internal) {
          console.log('Network: http://' + n.address + ':' + port);
        }
      });
    });

    if (!noOpen) launchApp(port, server);
  });

  process.on('SIGINT', function () {
    server.close();
    process.exit(0);
  });
  process.on('SIGTERM', function () {
    server.close();
    process.exit(0);
  });
});
