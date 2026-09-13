/**
 * SONDE o2switch — à déployer UNE FOIS, avant tout choix définitif, puis à supprimer.
 *
 * Mesure sur le vrai compte ce que la documentation ne dit pas :
 *   - version de Node réellement servie, nombre de processus Passenger ;
 *   - version et droits PostgreSQL (identity, extensions) ;
 *   - WebSocket : le handshake passe-t-il le proxy ?
 *   - SSE : les événements arrivent-ils au fil de l'eau ou bufferisés ?
 *   - durée maximale d'une requête (long-polling) ;
 *   - node:sqlite disponible (sans intérêt pour le Cloud, mais gratuit à vérifier).
 *
 * Protection : si SONDE_TOKEN est défini, chaque appel exige ?t=<jeton>.
 */
import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import os from 'node:os';
import pg from 'pg';

const TOKEN = process.env.SONDE_TOKEN ?? '';
const started = Date.now();

function authorized(url: URL): boolean {
  return !TOKEN || url.searchParams.get('t') === TOKEN;
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body, null, 2));
}

async function probePostgres() {
  const url = process.env.DATABASE_URL;
  if (!url) return { configured: false, hint: 'Définir DATABASE_URL=postgres://user:pass@localhost/base dans Setup Node.js App' };
  const client = new pg.Client({ connectionString: url });
  const out: Record<string, unknown> = { configured: true };
  try {
    await client.connect();
    out.version = (await client.query('select version() as v')).rows[0].v;
    out.serverVersionNum = (await client.query('show server_version_num')).rows[0].server_version_num;
    out.maxConnections = (await client.query('show max_connections')).rows[0].max_connections;
    out.extensions = (await client.query('select extname from pg_extension order by 1')).rows.map((r) => r.extname);
    out.availableUuidOssp = (await client.query("select count(*)::int as n from pg_available_extensions where name in ('uuid-ossp','pgcrypto')")).rows[0].n;
    await client.query('create temp table sonde_identity (id bigint generated always as identity primary key, v uuid)');
    await client.query("insert into sonde_identity (v) values ('0190f1f2-0000-7000-8000-000000000000')");
    out.identityAndUuid = 'OK';
    try {
      await client.query('create extension if not exists pgcrypto');
      out.createExtension = 'OK';
    } catch (e) {
      out.createExtension = `refusé : ${(e as Error).message}`;
    }
  } catch (e) {
    out.error = (e as Error).message;
  } finally {
    await client.end().catch(() => undefined);
  }
  return out;
}

async function probeSqlite() {
  try {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(':memory:');
    return (db.prepare('select sqlite_version() as v').get() as { v: string }).v;
  } catch (e) {
    return `indisponible : ${(e as Error).message}`;
  }
}

function sse(req: IncomingMessage, res: ServerResponse, count: number) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  // 2 Ko de commentaire : certains proxys ne transmettent qu'au-delà d'un seuil.
  res.write(`: ${' '.repeat(2048)}\n\n`);
  let i = 0;
  const timer = setInterval(() => {
    i += 1;
    res.write(`id: ${i}\ndata: ${JSON.stringify({ i, serverTs: Date.now(), pid: process.pid })}\n\n`);
    if (i >= count) {
      clearInterval(timer);
      res.end();
    }
  }, 1000);
  req.on('close', () => clearInterval(timer));
}

const PAGE = `<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sonde o2switch — AfriKaisse</title>
<style>body{font:14px/1.5 system-ui;margin:24px;max-width:900px}pre{background:#f4f1ea;padding:12px;overflow:auto}button{font:inherit;padding:8px 14px;margin:4px 4px 4px 0}</style>
<h1>Sonde o2switch</h1>
<p>Cliquez « Tout tester », attendez la fin (≈ 3 min), puis « Copier le rapport » et envoyez-le.</p>
<button id="all">Tout tester</button><button id="copy">Copier le rapport</button>
<pre id="out">…</pre>
<script>
const q = location.search; const out = document.getElementById('out'); const report = {};
const show = () => out.textContent = JSON.stringify(report, null, 2);
const get = (p) => fetch(p + q).then(r => r.json());
async function info(){ report.info = await get('info'); show(); }
async function pids(){ const s = new Set(); const t0 = Date.now();
  await Promise.all(Array.from({length: 12}, () => get('pid').then(r => s.add(r.pid))));
  report.processus = { distincts: [...s].length, dureeMs: Date.now() - t0 }; show(); }
async function pgsql(){ report.postgres = await get('pg'); show(); }
function ws(){ return new Promise(res => { const url = location.href.replace(/^http/, 'ws').split('?')[0].replace(/[^/]*$/, '') + 'ws' + q;
  const t0 = Date.now(); let done = false; const end = (v) => { if (!done) { done = true; report.websocket = v; show(); res(); } };
  try { const s = new WebSocket(url); s.onmessage = e => { end({ ok: true, message: e.data, ms: Date.now() - t0 }); s.close(); };
    s.onerror = () => end({ ok: false, erreur: 'échec du handshake ou connexion refusée' }); setTimeout(() => end({ ok: false, erreur: 'délai 10 s' }), 10000);
  } catch (e) { end({ ok: false, erreur: String(e) }); } }); }
function sse(){ return new Promise(res => { const recus = []; const t0 = Date.now(); const es = new EventSource('sse' + (q ? q + '&' : '?') + 'n=20');
  es.onmessage = e => { const d = JSON.parse(e.data); recus.push({ i: d.i, recuApresMs: Date.now() - t0, retardMs: Date.now() - d.serverTs }); report.sse = { recus }; show(); if (d.i >= 20) { es.close(); fin(); } };
  const fin = () => { const ecarts = recus.map((r, k) => k ? r.recuApresMs - recus[k-1].recuApresMs : r.recuApresMs);
    report.sse = { evenements: recus.length, fluide: recus.length >= 20 && Math.max(...ecarts.slice(1)) < 2500, premierApresMs: recus[0] && recus[0].recuApresMs, ecartMaxMs: Math.max(0, ...ecarts.slice(1)), recus }; show(); res(); };
  es.onerror = () => { es.close(); report.sse = Object.assign(report.sse || {}, { erreur: 'flux coupé', evenements: recus.length }); show(); res(); };
  setTimeout(() => { es.close(); fin(); }, 40000); }); }
async function attente(){ report.dureeMaxRequete = {}; for (const s of [25, 55, 95]) { const t0 = Date.now();
  try { const r = await fetch('wait' + (q ? q + '&' : '?') + 's=' + s); report.dureeMaxRequete[s + 's'] = r.ok ? 'OK après ' + Math.round((Date.now()-t0)/1000) + ' s' : 'HTTP ' + r.status + ' après ' + Math.round((Date.now()-t0)/1000) + ' s'; }
  catch (e) { report.dureeMaxRequete[s + 's'] = 'coupé après ' + Math.round((Date.now()-t0)/1000) + ' s'; } show(); } }
document.getElementById('all').onclick = async () => { report.debut = new Date().toISOString(); await info(); await pids(); await pgsql(); await ws(); await sse(); await attente(); report.fin = new Date().toISOString(); show(); };
document.getElementById('copy').onclick = () => navigator.clipboard.writeText(out.textContent);
</script></html>`;

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://sonde');
  if (!authorized(url)) return json(res, 403, { error: 'jeton requis (?t=)' });
  const route = url.pathname.replace(/\/+$/, '').split('/').pop() ?? '';

  switch (route) {
    case '':
    case 'sonde':
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(PAGE);
    case 'info':
      return json(res, 200, {
        node: process.version,
        plateforme: `${os.platform()} ${os.release()} ${os.arch()}`,
        cpus: os.cpus().length,
        memoireTotaleMo: Math.round(os.totalmem() / 1e6),
        memoireProcessusMo: Math.round(process.memoryUsage().rss / 1e6),
        pid: process.pid,
        processusDemarreIlYaS: Math.round((Date.now() - started) / 1000),
        variablesPassenger: Object.keys(process.env).filter((k) => /passenger|nodejs|port/i.test(k)),
        sqlite: await probeSqlite(),
        enTetesRecus: Object.keys(req.headers),
      });
    case 'pid':
      return json(res, 200, { pid: process.pid });
    case 'pg':
      return json(res, 200, await probePostgres());
    case 'sse':
      return sse(req, res, Math.min(Number(url.searchParams.get('n') ?? 20), 120));
    case 'wait': {
      const s = Math.min(Number(url.searchParams.get('s') ?? 25), 300);
      return setTimeout(() => json(res, 200, { attenduS: s }), s * 1000);
    }
    default:
      return json(res, 404, { error: 'inconnu' });
  }
});

// WebSocket minimal (RFC 6455) : seul le handshake et un message nous intéressent.
server.on('upgrade', (req, socket) => {
  const url = new URL(req.url ?? '/', 'http://sonde');
  const key = req.headers['sec-websocket-key'];
  if (!authorized(url) || typeof key !== 'string') return socket.destroy();
  const accept = createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  const payload = Buffer.from(JSON.stringify({ ok: true, pid: process.pid }));
  socket.write(Buffer.concat([Buffer.from([0x81, payload.length]), payload]));
  setTimeout(() => socket.end(), 2000);
});

server.listen(Number(process.env.PORT ?? 3000));
