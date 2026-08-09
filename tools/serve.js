// Tiny static server for smoke-testing the bundled build.
const http = require('http');
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'dist', 'index.html');

http.createServer(function (req, res) {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(fs.readFileSync(file));
}).listen(8177, function () {
  console.log('serving dist/index.html on http://localhost:8177');
});
