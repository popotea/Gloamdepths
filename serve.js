// 本地測試用靜態伺服器(零相依,只用 Node 內建模組)
// 用法:node serve.js,或直接雙擊「啟動遊戲.bat」
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8000;
const ROOT = __dirname;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.ico': 'image/x-icon',
};

// AI Hub「存入遊戲」用:把生成圖寫進 assets/ 底下的分類資料夾
// 只收白名單資料夾 + 嚴格檔名,避免被當成任意寫檔的後門(雖然只聽 127.0.0.1,仍防萬一)
const SAVE_DIRS = new Set(['monsters', 'tiles', 'items', 'animals']);
function saveAsset(req, res) {
  let body = '';
  req.on('data', c => { body += c; if (body.length > 15e6) req.destroy(); }); // 15MB 上限,擋異常請求
  req.on('end', () => {
    const json = h => { res.writeHead(h, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' }); };
    try {
      const { dir, name, b64, overwrite } = JSON.parse(body);
      if (!SAVE_DIRS.has(dir)) { json(400); res.end(JSON.stringify({ error: '不允許的資料夾: ' + dir })); return; }
      if (!/^[a-z0-9\-_]+\.png$/i.test(name || '')) { json(400); res.end(JSON.stringify({ error: '檔名只能是英數-_.png: ' + name })); return; }
      const folder = path.join(ROOT, 'assets', dir);
      fs.mkdirSync(folder, { recursive: true });
      const file = path.join(folder, name);
      if (fs.existsSync(file) && !overwrite) { json(409); res.end(JSON.stringify({ exists: true })); return; }
      fs.writeFileSync(file, Buffer.from(b64, 'base64'));
      const rel = 'assets/' + dir + '/' + name;
      console.log('💾 已儲存 ' + rel);
      json(200); res.end(JSON.stringify({ ok: true, path: rel }));
    } catch (e) { json(500); res.end(JSON.stringify({ error: e.message })); }
  });
}

const server = http.createServer((req, res) => {
  // AI Hub 可能用 file:// 開啟,跨來源呼叫存檔 API 需要 CORS 放行(只聽 127.0.0.1,風險可控)
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
    res.end(); return;
  }
  if (req.method === 'POST' && req.url.split('?')[0] === '/api/save-asset') { saveAsset(req, res); return; }
  // 檔名可能含空白或中文,要先解碼;並擋住跳脫到專案外的路徑
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const file = path.normalize(path.join(ROOT, urlPath));
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('404 Not Found: ' + urlPath); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
});

server.on('error', e => {
  if (e.code === 'EADDRINUSE') {
    console.log(`伺服器已在執行中(port ${PORT}),直接開 http://localhost:${PORT} 即可`);
    process.exit(0);
  }
  throw e;
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`✅ 微光深淵測試伺服器啟動:http://localhost:${PORT}`);
  console.log('   關閉這個視窗即可停止伺服器');
});
