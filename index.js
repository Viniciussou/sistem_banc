/* Central de Bancos — arquivo único para a Vercel (Express + MongoDB Atlas).
   Variáveis de ambiente na Vercel: MONGODB_URI (obrigatória) e DB_NAME (opcional, padrão "bancos"). */
const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.DB_NAME || 'bancos';

/* ---------- conexão (reaproveitada entre chamadas da Vercel) ---------- */
let db = null;
const cache = global.__bancos || (global.__bancos = { p: null });
function getDb() {
  if (!MONGODB_URI) return Promise.reject(new HttpError(500, 'A variável MONGODB_URI não está configurada na Vercel (Settings → Environment Variables).'));
  if (!cache.p) {
    cache.p = (async () => {
      const client = new MongoClient(MONGODB_URI, { maxPoolSize: 5, serverSelectionTimeoutMS: 8000, retryWrites: true, retryReads: true });
      await client.connect();
      const d = client.db(DB_NAME);
      await init(d);
      return d;
    })().catch(e => { cache.p = null; throw e; });
  }
  return cache.p;
}

/* traduz o erro de conexão em uma orientação clara */
function diagnose(e) {
  const m = String(e && e.message || e), raw = ' [detalhe: ' + m.slice(0, 160) + ']';
  if (/bad auth|Authentication failed|auth/i.test(m)) return 'O Atlas recusou o usuário/senha da MONGODB_URI. Confira o usuário e a senha em Database Access; se a senha tiver símbolos (@ : / ? # %), troque por uma senha só com letras e números ou codifique-os na URI.' + raw;
  if (/ENOTFOUND|querySrv|EBADNAME|ECONNREFUSED.*27017/i.test(m)) return 'O endereço do cluster na MONGODB_URI não foi encontrado. Copie de novo a string em Atlas → Connect → Drivers.' + raw;
  if (/Invalid scheme|Invalid connection string|must begin with|URI/i.test(m)) return 'A MONGODB_URI está em formato inválido. Ela deve começar com mongodb+srv:// ou mongodb://, sem aspas, sem espaços e sem os sinais < >.' + raw;
  if (/timed out|Server selection|ReplicaSetNoPrimary|ETIMEDOUT|SSL|TLS/i.test(m)) return 'O Atlas não respondeu: provavelmente o IP da Vercel não está liberado. No Atlas vá em Network Access → Add IP Address → "Allow access from anywhere" (0.0.0.0/0) e aguarde 1 minuto.' + raw;
  return 'Não foi possível conectar ao MongoDB.' + raw;
}

const SEED = [
  { name: 'Mercantil', access: 'disponivel', color: '#0f4c81', installments: [6, 12, 18, 24, 36, 48], rules: ['É possível subir pré, dependendo do login.', 'Pelo nosso login, é possível reapresentar, cancelar e verificar status.', 'Trabalha com parcelas de 6 até 48 vezes.', 'As parcelas podem ser quebradas.'] },
  { name: 'C6', access: 'matriz', color: '#2b2b2b', installments: [18, 24, 36, 48, 60], rules: ['Somente a matriz possui acesso.', 'Trabalha com 18, 24, 36, 48 e 60 parcelas.'] },
  { name: '3RN', access: 'disponivel', color: '#7a3e9d', installments: [24, 36, 48, 60], rules: ['Temos acesso ao banco.', 'Trabalha com 24, 36, 48 e 60 parcelas.'] },
  { name: 'Soma', access: 'matriz', color: '#c2410c', installments: [12, 18, 24, 36, 48, 60], rules: ['Somente a matriz possui acesso.', 'Trabalha com 12, 18, 24, 36, 48 e 60 parcelas.'] },
  { name: 'Facta', access: 'disponivel', color: '#0e7490', installments: [24, 36, 48, 60], rules: ['Temos acesso ao banco.', 'Trabalha com 24, 36, 48 e 60 parcelas.'] },
  { name: 'V8', access: 'disponivel', color: '#4d7c0f', installments: [12, 18, 24, 36, 48], rules: ['Temos acesso ao banco.', 'Trabalha com 12, 18, 24, 36 e 48 parcelas.'] },
  { name: 'Presença', access: 'disponivel', color: '#be185d', installments: [18, 24, 36, 48], rules: ['Temos acesso ao banco.', 'Trabalha com 18, 24, 36 e 48 parcelas.'] },
  { name: 'HandMas', access: 'disponivel', color: '#a16207', installments: [12, 18, 24, 36, 48], rules: ['Temos acesso ao banco.', 'Trabalha com 12, 18, 24, 36 e 48 parcelas.'] },
];

async function init(d) {
  await d.collection('tables').createIndex({ bankId: 1 });
  await d.collection('returns').createIndex({ bankId: 1 });
  await d.collection('audit_logs').createIndex({ at: -1 });
  await d.collection('meta').updateOne({ _id: 'version' }, { $setOnInsert: { v: 1 } }, { upsert: true });
  await d.collection('meta').updateOne({ _id: 'settings' }, { $setOnInsert: { rankCriterion: 'percent' } }, { upsert: true });
  try { await d.collection('meta').insertOne({ _id: 'seeded', at: new Date() }); }   // só a 1ª instância semeia
  catch (e) { if (e.code === 11000) return; throw e; }
  if ((await d.collection('banks').countDocuments()) === 0) {
    const now = new Date();
    await d.collection('banks').insertMany(SEED.map((b, i) => ({ ...b, logoUrl: '', notes: '', order: i, rev: 1, createdAt: now, updatedAt: now, updatedBy: 'sistema' })));
  }
}

/* ---------- utilidades ---------- */
class HttpError extends Error { constructor(status, msg, extra) { super(msg); this.status = status; this.extra = extra; } }
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const oid = id => { if (!ObjectId.isValid(id) || String(id).length !== 24) throw new HttpError(400, 'Identificador inválido.'); return new ObjectId(id); };
const str = (v, max, { required = false, field = 'Campo' } = {}) => {
  if (v === undefined || v === null) v = '';
  if (typeof v !== 'string') throw new HttpError(400, `${field} inválido.`);
  v = v.trim();
  if (required && !v) throw new HttpError(400, `${field} é obrigatório.`);
  if (v.length > max) throw new HttpError(400, `${field} excede ${max} caracteres.`);
  return v;
};
const pct = (v, field) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 1000) throw new HttpError(400, `${field} deve ser um número entre 0 e 1000.`);
  return Math.round(n * 10000) / 10000;
};
const instList = v => {
  if (!Array.isArray(v)) throw new HttpError(400, 'Lista de parcelas inválida.');
  const s = [...new Set(v.map(Number))];
  if (s.some(n => !Number.isInteger(n) || n < 1 || n > 360)) throw new HttpError(400, 'Parcelas devem ser inteiros entre 1 e 360.');
  return s.sort((a, b) => a - b);
};
const instMap = v => {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new HttpError(400, 'Percentuais por parcela inválidos.');
  const out = {};
  for (const [k, val] of Object.entries(v)) {
    const n = Number(k);
    if (!Number.isInteger(n) || n < 1 || n > 360) throw new HttpError(400, `Parcela inválida: ${k}.`);
    out[String(n)] = pct(val, `Percentual de ${k}x`);
  }
  return out;
};
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function diffs(oldDoc, changes) {
  const out = [];
  for (const [k, nv] of Object.entries(changes)) {
    if (k === 'installments' && oldDoc.installments && !Array.isArray(nv) && typeof nv === 'object') {
      const keys = new Set([...Object.keys(oldDoc.installments), ...Object.keys(nv)]);
      for (const p of [...keys].sort((a, b) => a - b)) {
        const o = oldDoc.installments[p] ?? null, n = nv[p] ?? null;
        if (!same(o, n)) out.push({ field: `percentual ${p}x`, old: o, new: n });
      }
    } else if (!same(oldDoc[k], nv)) out.push({ field: k, old: oldDoc[k] ?? null, new: nv });
  }
  return out;
}

/* quem está editando (sem login: o nome vem do navegador e vai para o histórico) */
function whoIs(req) {
  let n = ''; try { n = decodeURIComponent(req.headers['x-user'] || ''); } catch {}
  n = n.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 60);
  return { name: n };
}
const needName = (req, res, next) => { req.user = whoIs(req); next(req.user.name.length >= 2 ? undefined : new HttpError(400, 'Informe seu nome para salvar alterações.')); };

async function bump() {
  const r = await db.collection('meta').findOneAndUpdate({ _id: 'version' }, { $inc: { v: 1 } }, { upsert: true, returnDocument: 'after' });
  return r.v;
}
async function audit(user, entries) {
  if (!entries.length) return;
  const at = new Date();
  await db.collection('audit_logs').insertMany(entries.map(e => ({ at, userName: user.name, ...e })));
}

/* atualização com bloqueio otimista (campo rev) */
async function updateDoc(col, id, rev, changes, user, ctx) {
  const c = db.collection(col);
  const cur = await c.findOne({ _id: id });
  if (!cur) throw new HttpError(404, 'Registro não encontrado (pode ter sido excluído por outra pessoa).');
  if (!Number.isInteger(rev) || cur.rev !== rev) throw new HttpError(409, 'Este registro foi alterado por outra pessoa.', { current: cur });
  const d = diffs(cur, changes);
  if (!d.length) return { doc: cur };
  const upd = await c.findOneAndUpdate({ _id: id, rev }, { $set: { ...changes, updatedAt: new Date(), updatedBy: user.name }, $inc: { rev: 1 } }, { returnDocument: 'after' });
  if (!upd) throw new HttpError(409, 'Este registro foi alterado por outra pessoa.', { current: await c.findOne({ _id: id }) });
  await audit(user, d.map(x => ({ action: 'update', entity: ctx.entity, entityId: String(id), entityName: ctx.name(upd), bankId: ctx.bankId(upd), bankName: ctx.bankName, ...x })));
  await bump();
  return { doc: upd };
}
const bankName = async id => (await db.collection('banks').findOne({ _id: id }, { projection: { name: 1 } }))?.name || '(banco removido)';

/* ---------- app ---------- */
const HTML = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Central de Bancos</title>
<style>
:root{--bg:#f1f4f9;--card:#fff;--ink:#0f172a;--mut:#64748b;--line:#e2e8f0;--brand:#1e3a8a;--brand2:#2563eb;--ok:#15803d;--okbg:#dcfce7;--warn:#b45309;--warnbg:#fef3c7;--err:#b91c1c;--errbg:#fee2e2;--best:#ecfdf5;--r:12px;--sh:0 1px 2px rgba(15,23,42,.06),0 4px 14px rgba(15,23,42,.05)}
*{box-sizing:border-box}html,body{margin:0}body{font:14px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:var(--bg);color:var(--ink)}
button,input,select,textarea{font:inherit;color:inherit}
h1,h2,h3{margin:0}h2{font-size:20px}h3{font-size:15px}
.hide{display:none!important}
/* topbar */
.top{position:sticky;top:0;z-index:20;background:var(--brand);color:#fff;display:flex;align-items:center;gap:18px;padding:0 20px;height:56px}
.logo{font-weight:700;font-size:16px;letter-spacing:.2px;display:flex;gap:8px;align-items:center;cursor:pointer}
.logo i{width:26px;height:26px;border-radius:7px;background:#fff;color:var(--brand);display:grid;place-items:center;font-style:normal;font-weight:800}
.nav{display:flex;gap:4px;flex:1}.nav a{color:#cbd5f5;text-decoration:none;padding:7px 12px;border-radius:8px;font-weight:500}
.nav a:hover{background:rgba(255,255,255,.1)}.nav a.on{background:rgba(255,255,255,.18);color:#fff}
.sync{font-size:12px;color:#cbd5f5;display:flex;align-items:center;gap:8px}
.dot{width:8px;height:8px;border-radius:50%;background:#4ade80}.dot.bad{background:#f87171}.dot.old{background:#fbbf24}
.me{display:flex;align-items:center;gap:8px;font-size:13px}
.top .btn{background:rgba(255,255,255,.14);border-color:transparent;color:#fff}
.banner{padding:9px 20px;font-weight:500;display:flex;gap:12px;align-items:center}
.banner.warn{background:var(--warnbg);color:var(--warn)}.banner.err{background:var(--errbg);color:var(--err)}.banner.info{background:#dbeafe;color:#1e40af}
main{max-width:1280px;margin:0 auto;padding:22px 20px 60px}
/* controls */
.btn{border:1px solid var(--line);background:#fff;border-radius:9px;padding:7px 13px;cursor:pointer;font-weight:500;display:inline-flex;gap:6px;align-items:center}
.btn:hover{border-color:#94a3b8}.btn:disabled{opacity:.55;cursor:wait}
.btn.pri{background:var(--brand2);border-color:var(--brand2);color:#fff}.btn.pri:hover{background:#1d4ed8}
.btn.dan{color:var(--err);border-color:#fecaca}.btn.dan:hover{background:var(--errbg)}
.btn.sm{padding:4px 9px;font-size:12.5px}
.in,select.in,textarea.in{width:100%;border:1px solid #cbd5e1;border-radius:9px;padding:8px 11px;background:#fff}
.in:focus{outline:2px solid #93c5fd;border-color:var(--brand2)}
label.f{display:block;margin-bottom:12px;font-weight:600;font-size:12.5px;color:#334155}label.f .in{margin-top:4px;font-weight:400}
.row{display:flex;gap:12px;flex-wrap:wrap;align-items:center}.sp{flex:1}
.card{background:var(--card);border-radius:var(--r);box-shadow:var(--sh);padding:18px}
.badge{display:inline-block;padding:2px 9px;border-radius:99px;font-size:12px;font-weight:600;background:#e2e8f0;color:#334155}
.badge.ok{background:var(--okbg);color:var(--ok)}.badge.warn{background:var(--warnbg);color:var(--warn)}.badge.best{background:#059669;color:#fff}
.mut{color:var(--mut)}
.chips{display:flex;gap:6px;flex-wrap:wrap}.chip{border:1px solid #cbd5e1;background:#fff;border-radius:99px;padding:4px 12px;cursor:pointer;font-weight:600;font-size:13px}
.chip.on{background:var(--brand2);border-color:var(--brand2);color:#fff}
/* grid */
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:16px;margin-top:16px}
.bank{cursor:pointer;transition:.15s;position:relative}.bank:hover{transform:translateY(-2px);box-shadow:0 8px 24px rgba(15,23,42,.12)}
.av{width:44px;height:44px;border-radius:11px;color:#fff;display:grid;place-items:center;font-weight:800;font-size:17px;flex:none;overflow:hidden}.av img{width:100%;height:100%;object-fit:contain;background:#fff}
.av.lg{width:58px;height:58px;font-size:22px}
.bank .best{margin-top:12px;padding:9px 11px;border-radius:9px;background:var(--best);border:1px solid #a7f3d0;font-size:13px}
/* tables */
.tw{overflow:auto;border:1px solid var(--line);border-radius:10px;background:#fff}
table{border-collapse:collapse;width:100%}th,td{padding:9px 12px;text-align:right;border-bottom:1px solid var(--line);white-space:nowrap}
th:first-child,td:first-child,td.l,th.l{text-align:left}th{background:#f8fafc;font-size:12px;text-transform:uppercase;letter-spacing:.4px;color:#475569}
tr:last-child td{border-bottom:0}tr.off td{opacity:.5}
td.best{background:var(--best);color:#047857;font-weight:700}
td.pc{font-variant-numeric:tabular-nums}
.tabs{display:flex;gap:4px;border-bottom:1px solid var(--line);margin:18px 0 16px}.tabs button{border:0;background:none;padding:9px 16px;cursor:pointer;font-weight:600;color:var(--mut);border-bottom:3px solid transparent}
.tabs button.on{color:var(--brand2);border-bottom-color:var(--brand2)}
ul.rules{margin:0;padding-left:20px}ul.rules li{margin:5px 0}
/* modal */
.ov{position:fixed;inset:0;background:rgba(15,23,42,.5);display:flex;align-items:flex-start;justify-content:center;padding:5vh 14px;overflow:auto;z-index:50}
.md{background:#fff;border-radius:14px;width:100%;max-width:560px;box-shadow:0 20px 60px rgba(0,0,0,.35)}.md.w{max-width:760px}
.md header{padding:16px 20px;border-bottom:1px solid var(--line);font-weight:700;font-size:16px}.md .bd{padding:18px 20px}.md footer{padding:13px 20px;border-top:1px solid var(--line);display:flex;gap:8px;justify-content:flex-end;background:#f8fafc;border-radius:0 0 14px 14px}
.merr{background:var(--errbg);color:var(--err);padding:8px 11px;border-radius:8px;margin-bottom:12px;font-weight:500}
.toasts{position:fixed;right:16px;bottom:16px;display:flex;flex-direction:column;gap:8px;z-index:90}
.toast{background:#0f172a;color:#fff;padding:10px 15px;border-radius:10px;box-shadow:var(--sh);max-width:360px}.toast.ok{background:#166534}.toast.err{background:#991b1b}
.who{cursor:pointer}
.pgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(88px,1fr));gap:8px}.pgrid label{font-size:12px;color:#475569;font-weight:600}
.empty{padding:34px;text-align:center;color:var(--mut)}
.crumb{color:var(--mut);margin-bottom:10px}.crumb a{color:var(--brand2);cursor:pointer;text-decoration:none}
@media(max-width:800px){.top{flex-wrap:wrap;height:auto;padding:8px 12px}.nav{order:3;width:100%;overflow:auto}}
</style>
</head>
<body>
<div id="app"></div>
<div class="toasts" id="toasts"></div>

<script>
'use strict';
/* ========= util ========= */
const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => (n === null || n === undefined || n === '') ? '—' : Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + '%';
const pp = n => Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + ' p.p.';
const parseNum = s => { if (s === null || s === undefined) return null; s = String(s).trim().replace('%', '').replace(',', '.'); if (s === '') return null; const n = Number(s); if (!Number.isFinite(n)) throw new Error('Valor numérico inválido: ' + s); return n; };
const fmtDT = d => new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'medium' });
const accLabel = a => a === 'matriz' ? 'Somente matriz' : 'Acesso disponível';
const initials = n => n.replace(/[^\\p{L}\\p{N}]/gu, '').slice(0, 2).toUpperCase();
const lsGet = k => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
function toast(msg, type = '') { const t = document.createElement('div'); t.className = 'toast ' + type; t.textContent = msg; $('#toasts').append(t); setTimeout(() => t.remove(), type === 'err' ? 6000 : 3000); }
const avatar = (b, lg) => \`<div class="av \${lg ? 'lg' : ''}" style="background:\${esc(b.color || '#475569')}">\${b.logoUrl ? \`<img src="\${esc(b.logoUrl)}" alt="" onerror="this.remove()">\` : ''}\${esc(initials(b.name))}</div>\`;

/* ========= estado ========= */
const S = { name: lsGet('nome'), loaded: false, data: { banks: [], tables: [], returns: [], settings: { rankCriterion: 'percent' } }, version: 0, lastSync: null, syncErr: null, parcel: null, q: '', cmpParcel: null, cmpCrit: null, bankTab: 'tables', retQ: '', audit: null, auditQ: '', auditBank: '' };

class ApiError extends Error { constructor(m, status, body) { super(m); this.status = status; this.body = body; } }
async function api(path, { method = 'GET', body } = {}) {
  if (method !== 'GET' && !S.name) await askName();
  let r;
  try { r = await fetch('/api' + path, { method, headers: { 'Content-Type': 'application/json', 'x-user': encodeURIComponent(S.name || '') }, body: body ? JSON.stringify(body) : undefined }); }
  catch { throw new ApiError('Sem conexão com o servidor. A alteração NÃO foi salva.', 0); }
  let j = {}; try { j = await r.json(); } catch {}
  if (!r.ok) throw new ApiError(j.error || 'Erro ' + r.status, r.status, j);
  return j;
}
const bankOf = id => S.data.banks.find(b => b._id === id);
const tablesOf = id => S.data.tables.filter(t => t.bankId === id);

/* ========= identificação (sem login: só o nome, para o histórico) ========= */
function askName() {
  return new Promise((res, rej) => {
    modal({
      title: 'Quem está editando?',
      html: \`<p class="mut" style="margin-top:0">Seu nome fica registrado no histórico de alterações. Você só informa uma vez neste navegador.</p><label class="f">Seu nome<input class="in" name="nm" maxlength="60" value="\${esc(S.name)}"></label>\`,
      buttons: [{ label: 'Cancelar', run: async () => { rej(new Error('Informe seu nome para salvar alterações.')); } },
        { label: 'Continuar', cls: 'pri', run: async ov => { const v = val(ov, 'nm').trim(); if (v.length < 2) throw new Error('Digite seu nome.'); S.name = v; lsSet('nome', v); render(); res(); } }],
    });
  });
}

/* ========= sincronização (a cada 30 s e ao voltar para a aba) ========= */
async function loadAll(silent) {
  try {
    const d = await api('/bootstrap');
    S.data = { banks: d.banks, tables: d.tables, returns: d.returns, settings: d.settings };
    S.version = d.version; S.lastSync = Date.now(); S.syncErr = null; S.loaded = true;
    if (S.cmpCrit === null) S.cmpCrit = d.settings.rankCriterion;
    render();
  } catch (e) { S.syncErr = e.message; if (!S.loaded) render(); else renderSync(); if (!silent) toast(e.message, 'err'); }
}
async function checkVersion() {
  try { const { v } = await api('/version'); if (v !== S.version) await loadAll(true); else { S.lastSync = Date.now(); S.syncErr = null; renderSync(); } }
  catch (e) { S.syncErr = e.message; renderSync(); }
}
setInterval(() => { if (S.loaded && !document.hidden) checkVersion(); }, 30000);
setInterval(renderSync, 15000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && S.loaded) checkVersion(); });
const staleMin = () => S.lastSync ? (Date.now() - S.lastSync) / 60000 : 99;
function renderSync() {
  const el = $('#sync'); if (!el) return;
  const bad = !!S.syncErr, old = staleMin() > 3;
  el.innerHTML = \`<span class="dot \${bad ? 'bad' : old ? 'old' : ''}"></span>\${S.lastSync ? 'Atualizado às ' + new Date(S.lastSync).toLocaleTimeString('pt-BR') : 'Sincronizando…'}\`;
  const bn = $('#banner');
  if (bn) bn.innerHTML = bad ? \`<div class="banner err">⚠ Sem sincronização: \${esc(S.syncErr)} Os dados exibidos podem estar desatualizados. <button class="btn sm" data-a="refresh">Tentar agora</button></div>\`
    : old ? \`<div class="banner warn">Os dados não são atualizados há mais de 3 minutos e podem estar desatualizados. <button class="btn sm" data-a="refresh">Atualizar</button></div>\` : '';
}

/* ========= modal ========= */
function modal({ title, html, wide, buttons, onMount }) {
  const ov = document.createElement('div'); ov.className = 'ov';
  ov.innerHTML = \`<div class="md \${wide ? 'w' : ''}" role="dialog"><header>\${esc(title)}</header><div class="bd"><div class="merr hide"></div>\${html}</div><footer></footer></div>\`;
  const foot = ov.querySelector('footer'), err = ov.querySelector('.merr');
  const close = () => ov.remove();
  buttons.forEach(b => {
    const el = document.createElement('button'); el.className = 'btn ' + (b.cls || ''); el.textContent = b.label;
    el.onclick = async () => {
      if (!b.run) return close();
      err.classList.add('hide'); [...foot.children].forEach(x => x.disabled = true);
      let r; try { r = await b.run(ov); } catch (e) { err.textContent = e.message; err.classList.remove('hide'); err.scrollIntoView({ block: 'nearest' }); [...foot.children].forEach(x => x.disabled = false); return; }
      if (r === false) [...foot.children].forEach(x => x.disabled = false); else close();
    };
    foot.append(el);
  });
  ov.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type !== 'checkbox' && e.target.id !== 'np') { e.preventDefault(); foot.querySelector('.pri,.dan')?.click(); } });
  document.body.append(ov); onMount?.(ov);
  ov.querySelector('input:not([type=color]),textarea,select')?.focus();
  return close;
}
const confirmBox = (title, msg, label, run) => modal({ title, html: \`<p>\${msg}</p>\`, buttons: [{ label: 'Cancelar' }, { label, cls: 'dan', run }] });

/* salvar com tratamento de conflito (409) */
async function save(method, path, body) {
  try { const r = await api(path, { method, body }); await loadAll(true); return r; }
  catch (e) { if (e.status === 409 && e.body?.current) { await loadAll(true); throw Object.assign(e, { conflict: e.body.current }); } throw e; }
}
function conflictModal(cur, retry) {
  modal({
    title: 'Conflito de edição',
    html: \`<p><b>\${esc(cur.updatedBy || 'Outra pessoa')}</b> alterou este registro em \${fmtDT(cur.updatedAt)} enquanto você editava.</p><p>Nada foi sobrescrito. Escolha como prosseguir:</p>\`,
    buttons: [{ label: 'Descartar minha edição' }, { label: 'Aplicar minha edição sobre a versão atual', cls: 'pri', run: async () => { await retry(cur.rev); toast('Alteração salva.', 'ok'); } }],
  });
}
async function guarded(fn, retryFn) {
  try { await fn(); toast('Alteração salva.', 'ok'); }
  catch (e) { if (e.conflict) { conflictModal(e.conflict, retryFn); return false; } throw e; }
}

/* ========= ranking ========= */
const critLabel = c => c === 'meta' ? 'Maior diferença para a meta (percentual − meta)' : 'Maior percentual da parcela';
function score(t, n, crit) {
  const p = t.installments?.[n]; if (p === null || p === undefined) return null;
  if (crit === 'meta') return t.goalPercent === null || t.goalPercent === undefined ? null : p - t.goalPercent;
  return p;
}
function rankings(n, crit, bankId) {
  return S.data.tables.filter(t => t.active && (!bankId || t.bankId === bankId) && bankOf(t.bankId))
    .map(t => ({ t, b: bankOf(t.bankId), p: t.installments?.[n] ?? null, s: score(t, n, crit) }))
    .filter(x => x.s !== null).sort((a, b) => b.s - a.s);
}
const bestFor = (bankId, n) => rankings(n, S.data.settings.rankCriterion, bankId)[0] || null;

/* ========= render ========= */
function render() {
  const ae = document.activeElement, aid = ae && !ae.closest('.ov') ? ae.id : '', ss = aid ? ae.selectionStart : 0;
  const app = $('#app');
  if (!S.loaded) {
    app.innerHTML = \`<div class="top"><div class="logo"><i>B</i>Central de Bancos</div></div><main><div class="card empty">\${S.syncErr ? \`<b style="color:var(--err)">Não foi possível carregar os dados.</b><p>\${esc(S.syncErr)}</p><button class="btn pri" data-a="refresh">Tentar novamente</button>\` : 'Carregando…'}</div></main>\`;
    return;
  }
  const route = location.hash.slice(1) || '/';
  const page = route.startsWith('/bank/') ? bankView(route.split('/')[2]) : route === '/compare' ? compareView() : route === '/audit' ? auditView() : dashView();
  const nav = (h, l) => \`<a href="#\${h}" class="\${(route === h || (h === '/' && (route.startsWith('/bank') || !['/compare', '/audit'].includes(route)))) ? 'on' : ''}">\${l}</a>\`;
  app.innerHTML = \`<div class="top"><div class="logo" onclick="location.hash='#/'"><i>B</i>Central de Bancos</div>
    <nav class="nav">\${nav('/', 'Bancos')}\${nav('/compare', 'Comparar')}\${nav('/audit', 'Histórico')}</nav>
    <div class="sync"><span id="sync"></span><button class="btn sm" data-a="refresh" title="Atualizar agora">⟳</button></div>
    <div class="me"><button class="btn sm who" data-a="rename" title="Nome registrado no histórico">👤 \${S.name ? esc(S.name) : 'Informar meu nome'}</button></div></div><div id="banner"></div><main>\${page}</main>\`;
  renderSync();
  if (route === '/audit' && !S.audit) loadAudit();
  if (aid) { const n = document.getElementById(aid); if (n) { n.focus(); try { n.setSelectionRange(ss, ss); } catch {} } }
}
window.addEventListener('hashchange', () => { S.audit = null; if (S.loaded) render(); window.scrollTo(0, 0); });

/* --- painel --- */
const allParcels = () => [...new Set(S.data.banks.flatMap(b => b.installments))].sort((a, b) => a - b);
function dashView() {
  const q = S.q.trim().toLowerCase();
  const banks = S.data.banks.filter(b => (!q || b.name.toLowerCase().includes(q) || (b.rules || []).some(r => r.toLowerCase().includes(q)) || S.data.returns.some(r => r.bankId === b._id && (r.code + ' ' + r.meaning).toLowerCase().includes(q)))
    && (!S.parcel || b.installments.includes(S.parcel)));
  const best = S.parcel ? rankings(S.parcel, S.data.settings.rankCriterion)[0] : null;
  return \`<div class="row"><h2>Bancos</h2><span class="sp"></span>
    <input class="in" id="q" style="max-width:340px" placeholder="Buscar banco, regra ou retorno…" value="\${esc(S.q)}">
    <button class="btn pri" data-a="newBank">+ Novo banco</button></div>
  <div class="row" style="margin-top:12px"><span class="mut">Parcelas:</span><div class="chips"><button class="chip \${!S.parcel ? 'on' : ''}" data-a="parcel" data-n="">Todas</button>\${allParcels().map(n => \`<button class="chip \${S.parcel === n ? 'on' : ''}" data-a="parcel" data-n="\${n}">\${n}x</button>\`).join('')}</div></div>
  \${best ? \`<div class="card" style="margin-top:14px;border-left:5px solid #059669"><b>Melhor opção em \${S.parcel}x:</b> \${esc(best.b.name)} — \${esc(best.t.name)} · \${fmt(best.p)} <span class="mut">(\${critLabel(S.data.settings.rankCriterion).toLowerCase()})</span></div>\` : ''}
  <div class="grid">\${banks.map(b => {
    const bt = S.parcel ? bestFor(b._id, S.parcel) : null, nt = tablesOf(b._id).filter(t => t.active).length;
    return \`<div class="card bank" data-a="open" data-id="\${b._id}"><div class="row" style="flex-wrap:nowrap">\${avatar(b)}<div><h3>\${esc(b.name)}</h3><span class="badge \${b.access === 'matriz' ? 'warn' : 'ok'}">\${accLabel(b.access)}</span></div></div>
      <p class="mut" style="margin:12px 0 0">Parcelas: \${b.installments.map(n => n + 'x').join(' · ') || '—'}</p>
      <p class="mut" style="margin:4px 0 0">\${nt} tabela(s) ativa(s) · \${S.data.returns.filter(r => r.bankId === b._id).length} retorno(s)</p>
      \${S.parcel ? \`<div class="best">\${bt ? \`<b>Melhor em \${S.parcel}x:</b> \${esc(bt.t.name)} — \${fmt(bt.p)}\` : \`<span class="mut">Sem tabela cadastrada para \${S.parcel}x</span>\`}</div>\` : ''}</div>\`;
  }).join('') || '<div class="empty" style="grid-column:1/-1">Nenhum banco encontrado.</div>'}</div>\`;
}

/* --- banco --- */
function bankView(id) {
  const b = bankOf(id);
  if (!b) return \`<div class="empty">Banco não encontrado (pode ter sido excluído). <a href="#/">Voltar</a></div>\`;
  const tabs = [['tables', 'Tabelas e percentuais'], ['rules', 'Regras operacionais'], ['returns', 'Retornos do banco']];
  return \`<div class="crumb"><a href="#/">Bancos</a> / \${esc(b.name)}</div>
  <div class="card"><div class="row">\${avatar(b, true)}<div><h2>\${esc(b.name)}</h2><span class="badge \${b.access === 'matriz' ? 'warn' : 'ok'}">\${accLabel(b.access)}</span>
  <div class="mut" style="margin-top:4px">Parcelas: \${b.installments.map(n => n + 'x').join(' · ') || '—'}</div></div><span class="sp"></span>
  <button class="btn" data-a="editBank" data-id="\${id}">Editar banco</button><button class="btn dan" data-a="delBank" data-id="\${id}">Excluir</button></div></div>
  <div class="tabs">\${tabs.map(([k, l]) => \`<button class="\${S.bankTab === k ? 'on' : ''}" data-a="tab" data-k="\${k}">\${l}</button>\`).join('')}</div>
  \${S.bankTab === 'tables' ? tablesTab(b) : S.bankTab === 'rules' ? rulesTab(b) : returnsTab(b)}\`;
}
function tablesTab(b) {
  const ts = tablesOf(b._id), cols = [...new Set([...b.installments, ...ts.flatMap(t => Object.keys(t.installments || {}).map(Number))])].sort((a, b) => a - b);
  const bestBy = {}; cols.forEach(n => { const r = bestFor(b._id, n); if (r) bestBy[n] = r.t._id; });
  return \`<div class="row" style="margin-bottom:12px"><span class="mut">Destaque verde = melhor tabela ativa na parcela (\${critLabel(S.data.settings.rankCriterion).toLowerCase()}).</span><span class="sp"></span><button class="btn pri" data-a="newTable" data-id="\${b._id}">+ Nova tabela</button></div>
  \${ts.length ? \`<div class="tw"><table><thead><tr><th>Tabela</th><th>Ref.</th><th>Meta</th>\${cols.map(n => \`<th>\${n}x</th>\`).join('')}<th class="l">Obs.</th><th></th></tr></thead><tbody>
  \${ts.map(t => \`<tr class="\${t.active ? '' : 'off'}"><td><b>\${esc(t.name)}</b>\${t.active ? '' : ' <span class="badge">inativa</span>'}</td><td class="pc">\${fmt(t.refPercent)}</td><td class="pc">\${fmt(t.goalPercent)}</td>
   \${cols.map(n => \`<td class="pc \${bestBy[n] === t._id ? 'best' : ''}">\${fmt(t.installments?.[n])}</td>\`).join('')}<td class="l mut" style="white-space:normal;max-width:220px">\${esc(t.notes)}</td>
   <td><button class="btn sm" data-a="editTable" data-id="\${t._id}">Editar</button> <button class="btn sm" data-a="dupTable" data-id="\${t._id}">Duplicar</button> <button class="btn sm" data-a="togTable" data-id="\${t._id}">\${t.active ? 'Desativar' : 'Ativar'}</button> <button class="btn sm dan" data-a="delTable" data-id="\${t._id}">Excluir</button></td></tr>\`).join('')}
  </tbody></table></div>\${tableDiffs(b, cols)}\` : '<div class="card empty">Nenhuma tabela cadastrada para este banco.</div>'}\`;
}
function tableDiffs(b, cols) {
  const act = tablesOf(b._id).filter(t => t.active); if (act.length < 2) return '';
  return \`<h3 style="margin:22px 0 8px">Diferença entre as tabelas (em pontos percentuais, vs. a melhor)</h3><div class="tw"><table><thead><tr><th>Tabela</th>\${cols.map(n => \`<th>\${n}x</th>\`).join('')}</tr></thead><tbody>
  \${act.map(t => \`<tr><td>\${esc(t.name)}</td>\${cols.map(n => { const vs = act.map(x => x.installments?.[n]).filter(v => v !== null && v !== undefined); const mx = Math.max(...vs), v = t.installments?.[n]; return \`<td class="pc">\${v === null || v === undefined || !vs.length ? '—' : (v - mx === 0 ? '<span class="badge best">melhor</span>' : pp(v - mx))}</td>\`; }).join('')}</tr>\`).join('')}</tbody></table></div>\`;
}
function rulesTab(b) {
  return \`<div class="card"><div class="row"><h3>Regras operacionais</h3><span class="sp"></span><button class="btn" data-a="editRules" data-id="\${b._id}">Editar regras</button></div>
  \${b.rules?.length ? \`<ul class="rules">\${b.rules.map(r => \`<li>\${esc(r)}</li>\`).join('')}</ul>\` : '<p class="mut">Nenhuma regra cadastrada.</p>'}
  \${b.notes ? \`<h3 style="margin-top:18px">Informações adicionais</h3><p style="white-space:pre-wrap">\${esc(b.notes)}</p>\` : ''}
  <p class="mut" style="margin-bottom:0;margin-top:16px;font-size:12px">Última alteração: \${esc(b.updatedBy || '—')} em \${b.updatedAt ? fmtDT(b.updatedAt) : '—'}</p></div>\`;
}
function returnsTab(b) {
  const q = S.retQ.trim().toLowerCase();
  const rs = S.data.returns.filter(r => r.bankId === b._id && (!q || (r.code + ' ' + r.meaning + ' ' + r.guidance).toLowerCase().includes(q)));
  return \`<div class="row" style="margin-bottom:12px"><input class="in" id="rq" style="max-width:340px" placeholder="Pesquisar por código ou descrição…" value="\${esc(S.retQ)}"><span class="sp"></span><button class="btn pri" data-a="newRet" data-id="\${b._id}">+ Novo retorno</button></div>
  \${rs.length ? \`<div class="tw"><table><thead><tr><th>Retorno</th><th class="l">Significado</th><th class="l">Como proceder</th><th></th></tr></thead><tbody>
  \${rs.map(r => \`<tr><td style="white-space:normal;max-width:240px"><b>\${esc(r.code)}</b></td><td class="l" style="white-space:normal">\${esc(r.meaning)}</td><td class="l" style="white-space:normal">\${esc(r.guidance)}</td>
  <td><button class="btn sm" data-a="editRet" data-id="\${r._id}">Editar</button> <button class="btn sm dan" data-a="delRet" data-id="\${r._id}">Excluir</button></td></tr>\`).join('')}</tbody></table></div>\` : \`<div class="card empty">\${q ? 'Nenhum retorno encontrado.' : 'Nenhum retorno cadastrado para este banco ainda.'}</div>\`}\`;
}

/* --- comparar --- */
function compareView() {
  const ps = allParcels(); if (!S.cmpParcel || !ps.includes(S.cmpParcel)) S.cmpParcel = ps[0] || null;
  const crit = S.cmpCrit || S.data.settings.rankCriterion;
  const rk = S.cmpParcel ? rankings(S.cmpParcel, crit) : [];
  const top = rk[0];
  const perBank = S.data.banks.map(b => ({ b, r: rankings(S.cmpParcel, crit, b._id)[0] })).filter(x => x.r).sort((a, b) => b.r.s - a.r.s);
  return \`<div class="row"><h2>Comparar bancos</h2><span class="sp"></span><label class="mut">Critério: <select class="in" id="crit" style="width:auto;display:inline-block">
   <option value="percent" \${crit === 'percent' ? 'selected' : ''}>Maior percentual da parcela</option><option value="meta" \${crit === 'meta' ? 'selected' : ''}>Maior diferença para a meta</option></select></label>
   \${crit !== S.data.settings.rankCriterion ? '<button class="btn sm" data-a="setDefault">Definir como padrão de todos</button>' : '<span class="badge">padrão atual</span>'}</div>
  <div class="row" style="margin-top:12px"><span class="mut">Parcelas:</span><div class="chips">\${ps.map(n => \`<button class="chip \${S.cmpParcel === n ? 'on' : ''}" data-a="cmpP" data-n="\${n}">\${n}x</button>\`).join('')}</div></div>
  <p class="mut">Somente tabelas <b>ativas</b> com percentual cadastrado em \${S.cmpParcel}x entram na comparação; parcelas diferentes nunca são misturadas.\${crit === 'meta' ? ' Tabelas sem meta cadastrada ficam fora deste critério.' : ''}</p>
  \${top ? \`<div class="card" style="border-left:5px solid #059669;margin-bottom:16px"><span class="badge best">Melhor em \${S.cmpParcel}x</span> <b style="font-size:16px">\${esc(top.b.name)} — \${esc(top.t.name)}</b> · \${fmt(top.p)}\${top.t.goalPercent != null ? \` · meta \${fmt(top.t.goalPercent)} (dif. \${pp(top.p - top.t.goalPercent)})\` : ''}</div>\` : ''}
  <h3 style="margin-bottom:8px">Melhor tabela de cada banco</h3>
  \${perBank.length ? \`<div class="grid" style="margin-top:0">\${perBank.map(({ b, r }) => \`<div class="card bank" data-a="open" data-id="\${b._id}"><div class="row" style="flex-wrap:nowrap">\${avatar(b)}<div><b>\${esc(b.name)}</b><div class="mut">\${esc(r.t.name)}</div></div><span class="sp"></span><div style="text-align:right"><div style="font-size:20px;font-weight:800">\${fmt(r.p)}</div><div class="mut" style="font-size:12px">\${r.t.goalPercent != null ? 'meta ' + fmt(r.t.goalPercent) : 'sem meta'}</div></div></div></div>\`).join('')}</div>\` : '<div class="card empty">Nenhuma tabela com dados para esta parcela.</div>'}
  <h3 style="margin:22px 0 8px">Ranking completo — \${S.cmpParcel || ''}x</h3>
  \${rk.length ? \`<div class="tw"><table><thead><tr><th>#</th><th class="l">Banco</th><th class="l">Tabela</th><th>Percentual</th><th>Meta</th><th>Dif. vs meta</th><th>Dif. vs melhor</th></tr></thead><tbody>
  \${rk.map((x, i) => \`<tr><td>\${i + 1}</td><td class="l">\${esc(x.b.name)} \${x.b.access === 'matriz' ? '<span class="badge warn">matriz</span>' : ''}</td><td class="l">\${esc(x.t.name)}</td><td class="pc \${i === 0 ? 'best' : ''}">\${fmt(x.p)}</td><td class="pc">\${fmt(x.t.goalPercent)}</td>
  <td class="pc">\${x.t.goalPercent != null ? pp(x.p - x.t.goalPercent) : '—'}</td><td class="pc">\${i === 0 ? '—' : pp(x.s - top.s)}</td></tr>\`).join('')}</tbody></table></div>\` : ''}\`;
}

/* --- histórico --- */
async function loadAudit() {
  try {
    const p = new URLSearchParams({ limit: 200 }); if (S.auditQ) p.set('q', S.auditQ); if (S.auditBank) p.set('bankId', S.auditBank);
    S.audit = await api('/audit?' + p); render();
  } catch (e) { S.audit = { items: [], total: 0 }; toast(e.message, 'err'); render(); }
}
function auditView() {
  const a = S.audit;
  return \`<div class="row"><h2>Histórico de alterações</h2><span class="sp"></span>
  <select class="in" id="aBank" style="width:auto"><option value="">Todos os bancos</option>\${S.data.banks.map(b => \`<option value="\${b._id}" \${S.auditBank === b._id ? 'selected' : ''}>\${esc(b.name)}</option>\`).join('')}</select>
  <input class="in" id="aq" style="max-width:260px" placeholder="Buscar nome, tabela, campo…" value="\${esc(S.auditQ)}"></div>
  <div class="tw" style="margin-top:14px">\${!a ? '<div class="empty">Carregando…</div>' : a.items.length ? \`<table><thead><tr><th class="l">Data/hora</th><th class="l">Quem</th><th class="l">Banco</th><th class="l">Item</th><th class="l">Campo</th><th class="l">Valor anterior</th><th class="l">Novo valor</th></tr></thead><tbody>
  \${a.items.map(i => \`<tr><td class="l">\${fmtDT(i.at)}</td><td class="l">\${esc(i.userName)}</td><td class="l">\${esc(i.bankName || '—')}</td><td class="l">\${esc(i.entity)}: \${esc(i.entityName)}</td><td class="l">\${esc(i.field)}</td><td class="l" style="white-space:normal;max-width:240px">\${esc(show(i.old, i.field))}</td><td class="l" style="white-space:normal;max-width:240px">\${esc(show(i.new, i.field))}</td></tr>\`).join('')}</tbody></table>\` : '<div class="empty">Nenhum registro.</div>'}</div>
  \${a ? \`<p class="mut">Exibindo \${a.items.length} de \${a.total} registros.</p>\` : ''}\`;
}
function show(v, f) { if (v === null || v === undefined) return '—'; if (Array.isArray(v)) return v.join(f === 'installments' ? ', ' : ' | '); if (typeof v === 'number' && /percentual|Percent|meta/i.test(f)) return fmt(v); if (typeof v === 'object') return JSON.stringify(v); return String(v); }

/* ========= formulários ========= */
const val = (ov, n) => ov.querySelector(\`[name="\${n}"]\`).value;

function bankForm(b) {
  const nb = !b; b = b || { name: '', access: 'disponivel', color: '#1e3a8a', logoUrl: '', installments: [] };
  modal({
    title: nb ? 'Novo banco' : 'Editar banco', html: \`
    <label class="f">Nome<input class="in" name="name" value="\${esc(b.name)}" maxlength="60"></label>
    <div class="row"><label class="f sp">Acesso<select class="in" name="access"><option value="disponivel" \${b.access === 'disponivel' ? 'selected' : ''}>Acesso disponível</option><option value="matriz" \${b.access === 'matriz' ? 'selected' : ''}>Somente matriz</option></select></label>
    <label class="f">Cor<input class="in" type="color" name="color" value="\${esc(b.color || '#1e3a8a')}" style="padding:2px;height:38px;width:70px"></label></div>
    <label class="f">Logotipo (link de imagem, opcional)<input class="in" name="logoUrl" value="\${esc(b.logoUrl || '')}" placeholder="https://…"></label>
    <label class="f">Parcelas disponíveis (separe por vírgula)<input class="in" name="inst" value="\${esc(b.installments.join(', '))}" placeholder="12, 24, 36, 48"></label>\`,
    buttons: [{ label: 'Cancelar' }, {
      label: 'Salvar', cls: 'pri', run: async ov => {
        const body = { name: val(ov, 'name'), access: val(ov, 'access'), color: val(ov, 'color'), logoUrl: val(ov, 'logoUrl'), installments: val(ov, 'inst').split(/[,;\\s]+/).filter(Boolean).map(Number) };
        if (body.installments.some(n => !Number.isInteger(n) || n < 1)) throw new Error('Parcelas inválidas.');
        if (nb) { const r = await save('POST', '/banks', body); toast('Banco cadastrado.', 'ok'); location.hash = '#/bank/' + r.doc._id; return; }
        const run = rev => save('PUT', '/banks/' + b._id, { ...body, rev });
        return (await guarded(() => run(b.rev), run)) === false ? false : undefined;
      }
    }],
  });
}
function rulesForm(b) {
  modal({
    wide: true, title: 'Editar regras — ' + b.name, html: \`
    <label class="f">Regras operacionais (uma por linha)<textarea class="in" name="rules" rows="9">\${esc((b.rules || []).join('\\n'))}</textarea></label>
    <label class="f">Informações adicionais<textarea class="in" name="notes" rows="4">\${esc(b.notes || '')}</textarea></label>\`,
    buttons: [{ label: 'Cancelar' }, {
      label: 'Salvar', cls: 'pri', run: async ov => {
        const body = { rules: val(ov, 'rules').split('\\n').map(s => s.trim()).filter(Boolean), notes: val(ov, 'notes') };
        const run = rev => save('PUT', '/banks/' + b._id, { ...body, rev });
        return (await guarded(() => run(b.rev), run)) === false ? false : undefined;
      }
    }],
  });
}
const pcell = (n, v) => \`<div data-cell="\${n}"><label>\${n}x <span data-rm="1" style="cursor:pointer;color:#b91c1c" title="Remover parcela">×</span><input class="in" value="\${v ?? ''}" placeholder="%" style="margin-top:3px"></label></div>\`;
function tableForm(bank, t, copyOf) {
  const isNew = !t; const src = t || copyOf || { name: '', refPercent: null, goalPercent: null, installments: {}, notes: '', active: true };
  const name0 = copyOf ? copyOf.name + ' (cópia)' : src.name;
  modal({
    wide: true, title: (isNew ? (copyOf ? 'Duplicar tabela' : 'Nova tabela') : 'Editar tabela') + ' — ' + bank.name, html: \`
    <div class="row"><label class="f sp" style="min-width:220px">Nome / identificação<input class="in" name="name" value="\${esc(name0)}" maxlength="80"></label>
    <label class="f">Percentual de referência<input class="in" name="ref" value="\${src.refPercent ?? ''}" placeholder="%"></label>
    <label class="f">Meta (%)<input class="in" name="goal" value="\${src.goalPercent ?? ''}" placeholder="%"></label></div>
    <p style="font-weight:600;font-size:12.5px;color:#334155;margin:4px 0 6px">Percentual por quantidade de parcelas <span class="mut" style="font-weight:400">(deixe vazio se não houver)</span></p>
    <div class="pgrid" id="pg">\${[...new Set([...bank.installments, ...Object.keys(src.installments || {}).map(Number)])].sort((a, b) => a - b).map(n => pcell(n, src.installments?.[n])).join('')}</div>
    <div class="row" style="margin:10px 0 14px"><input class="in" id="np" style="width:90px" placeholder="ex.: 30"><button type="button" class="btn sm" id="addp">+ Adicionar parcela</button><span class="mut">Clique no × para remover uma parcela.</span></div>
    <label class="f">Observações<textarea class="in" name="notes" rows="2">\${esc(src.notes || '')}</textarea></label>
    <label class="f"><input type="checkbox" name="active" \${src.active !== false ? 'checked' : ''}> Tabela ativa (entra nas comparações)</label>\`,
    onMount: ov => {
      ov.addEventListener('click', e => { if (e.target.dataset.rm) e.target.closest('[data-cell]').remove(); });
      ov.querySelector('#addp').onclick = () => { const n = Number(ov.querySelector('#np').value); if (!Number.isInteger(n) || n < 1 || n > 360) return toast('Parcela inválida.', 'err'); if (ov.querySelector(\`[data-cell="\${n}"]\`)) return toast('Parcela já existe.', 'err'); ov.querySelector('#pg').insertAdjacentHTML('beforeend', pcell(n, null)); ov.querySelector('#np').value = ''; };
    },
    buttons: [{ label: 'Cancelar' }, {
      label: 'Salvar', cls: 'pri', run: async ov => {
        const inst = {}; ov.querySelectorAll('[data-cell]').forEach(c => { inst[c.dataset.cell] = parseNum(c.querySelector('input').value); });
        const body = { name: val(ov, 'name'), refPercent: parseNum(val(ov, 'ref')), goalPercent: parseNum(val(ov, 'goal')), installments: inst, notes: val(ov, 'notes'), active: ov.querySelector('[name="active"]').checked };
        if (isNew) { await save('POST', '/tables', { ...body, bankId: bank._id }); toast('Tabela cadastrada.', 'ok'); return; }
        const run = rev => save('PUT', '/tables/' + t._id, { ...body, rev });
        return (await guarded(() => run(t.rev), run)) === false ? false : undefined;
      }
    }],
  });
}
function retForm(bank, r) {
  const isNew = !r; r = r || { code: '', meaning: '', guidance: '' };
  modal({
    title: (isNew ? 'Novo retorno' : 'Editar retorno') + ' — ' + bank.name, html: \`
    <label class="f">Código ou mensagem recebida<input class="in" name="code" value="\${esc(r.code)}" maxlength="200"></label>
    <label class="f">Significado<textarea class="in" name="meaning" rows="3">\${esc(r.meaning)}</textarea></label>
    <label class="f">Como proceder (opcional)<textarea class="in" name="guidance" rows="3">\${esc(r.guidance)}</textarea></label>\`,
    buttons: [{ label: 'Cancelar' }, {
      label: 'Salvar', cls: 'pri', run: async ov => {
        const body = { code: val(ov, 'code'), meaning: val(ov, 'meaning'), guidance: val(ov, 'guidance') };
        if (isNew) { await save('POST', '/returns', { ...body, bankId: bank._id }); toast('Retorno cadastrado.', 'ok'); return; }
        const run = rev => save('PUT', '/returns/' + r._id, { ...body, rev });
        return (await guarded(() => run(r.rev), run)) === false ? false : undefined;
      }
    }],
  });
}

/* ========= eventos ========= */
document.addEventListener('input', e => {
  if (e.target.id === 'q') { S.q = e.target.value; render(); }
  if (e.target.id === 'rq') { S.retQ = e.target.value; render(); }
  if (e.target.id === 'aq') { clearTimeout(window._at); const v = e.target.value; window._at = setTimeout(() => { S.auditQ = v; loadAudit(); }, 400); }
});
document.addEventListener('change', async e => {
  if (e.target.id === 'crit') { S.cmpCrit = e.target.value; render(); }
  if (e.target.id === 'aBank') { S.auditBank = e.target.value; loadAudit(); }
});
document.addEventListener('click', async e => {
  const el = e.target.closest('[data-a]'); if (!el || el.closest('.md')) return;
  const a = el.dataset.a, id = el.dataset.id;
  const fail = x => toast(x.message, 'err');
  switch (a) {
    case 'refresh': await loadAll(); if (!S.syncErr) toast('Dados atualizados.', 'ok'); break;
    case 'rename': S.name = ''; try { await askName(); } catch { S.name = lsGet('nome'); } render(); break;
    case 'open': S.bankTab = 'tables'; S.retQ = ''; location.hash = '#/bank/' + id; break;
    case 'parcel': S.parcel = el.dataset.n ? Number(el.dataset.n) : null; render(); break;
    case 'cmpP': S.cmpParcel = Number(el.dataset.n); render(); break;
    case 'tab': S.bankTab = el.dataset.k; render(); break;
    case 'setDefault': try { await api('/settings', { method: 'PUT', body: { rankCriterion: S.cmpCrit } }); await loadAll(true); toast('Critério padrão atualizado para todos.', 'ok'); } catch (x) { fail(x); } break;
    case 'newBank': bankForm(); break;
    case 'editBank': bankForm(bankOf(id)); break;
    case 'delBank': {
      const b = bankOf(id), nt = tablesOf(id).length, nr = S.data.returns.filter(r => r.bankId === id).length;
      modal({ title: 'Excluir banco', html: \`<p>Isto exclui <b>\${esc(b.name)}</b> junto com \${nt} tabela(s) e \${nr} retorno(s). Não pode ser desfeito.</p><label class="f">Digite o nome do banco para confirmar<input class="in" name="cf" autocomplete="off"></label>\`,
        buttons: [{ label: 'Cancelar' }, { label: 'Excluir', cls: 'dan', run: async ov => { if (val(ov, 'cf').trim().toLowerCase() !== b.name.toLowerCase()) throw new Error('O nome digitado não confere.'); await save('DELETE', '/banks/' + id); toast('Banco excluído.', 'ok'); location.hash = '#/'; } }] });
      break;
    }
    case 'editRules': rulesForm(bankOf(id)); break;
    case 'newTable': tableForm(bankOf(id)); break;
    case 'editTable': { const t = S.data.tables.find(x => x._id === id); tableForm(bankOf(t.bankId), t); break; }
    case 'dupTable': { const t = S.data.tables.find(x => x._id === id); tableForm(bankOf(t.bankId), null, t); break; }
    case 'togTable': { const t = S.data.tables.find(x => x._id === id); const run = rev => save('PUT', '/tables/' + id, { active: !t.active, rev }); try { await guarded(() => run(t.rev), run); } catch (x) { fail(x); } break; }
    case 'delTable': { const t = S.data.tables.find(x => x._id === id); confirmBox('Excluir tabela', \`Excluir a tabela <b>\${esc(t.name)}</b>? Não pode ser desfeito (fica registrado no histórico).\`, 'Excluir', async () => { await save('DELETE', '/tables/' + id); toast('Tabela excluída.', 'ok'); }); break; }
    case 'newRet': retForm(bankOf(id)); break;
    case 'editRet': { const r = S.data.returns.find(x => x._id === id); retForm(bankOf(r.bankId), r); break; }
    case 'delRet': { const r = S.data.returns.find(x => x._id === id); confirmBox('Excluir retorno', \`Excluir o retorno <b>\${esc(r.code)}</b>?\`, 'Excluir', async () => { await save('DELETE', '/returns/' + id); toast('Retorno excluído.', 'ok'); }); break; }
  }
});
render(); loadAll(true);
</script>
</body>
</html>
`;
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '200kb' }));
app.use((req, res, next) => { res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Cache-Control': 'no-store' }); next(); });
app.get('/', (req, res) => res.type('html').send(HTML));
app.get('/favicon.ico', (req, res) => res.status(204).end());

app.use('/api', wrap(async (req, res, next) => {
  try { db = await getDb(); }
  catch (e) { throw e instanceof HttpError ? e : new HttpError(503, diagnose(e)); }
  next();
}));

app.get('/api/bootstrap', wrap(async (req, res) => {
  const [banks, tables, returns, settings, ver] = await Promise.all([
    db.collection('banks').find().sort({ order: 1, name: 1 }).toArray(),
    db.collection('tables').find().sort({ name: 1 }).toArray(),
    db.collection('returns').find().sort({ code: 1 }).toArray(),
    db.collection('meta').findOne({ _id: 'settings' }),
    db.collection('meta').findOne({ _id: 'version' }),
  ]);
  res.json({ banks, tables, returns, settings: { rankCriterion: settings?.rankCriterion || 'percent' }, version: ver?.v || 1 });
}));
app.get('/api/version', wrap(async (req, res) => res.json({ v: (await db.collection('meta').findOne({ _id: 'version' }))?.v || 1 })));

/* ---------- bancos ---------- */
const bankFields = (b, partial) => {
  const o = {};
  if (!partial || 'name' in b) o.name = str(b.name, 60, { required: true, field: 'Nome' });
  if (!partial || 'access' in b) { if (!['disponivel', 'matriz'].includes(b.access)) throw new HttpError(400, 'Acesso inválido.'); o.access = b.access; }
  if (!partial || 'color' in b) { const c = str(b.color || '#475569', 9); if (!/^#[0-9a-fA-F]{6}$/.test(c)) throw new HttpError(400, 'Cor inválida.'); o.color = c; }
  if (!partial || 'logoUrl' in b) { const u = str(b.logoUrl, 500); if (u && !/^https?:\/\//i.test(u)) throw new HttpError(400, 'O logotipo deve ser um link http(s).'); o.logoUrl = u; }
  if (!partial || 'installments' in b) o.installments = instList(b.installments || []);
  if (!partial || 'rules' in b) { if (!Array.isArray(b.rules) || b.rules.length > 100) throw new HttpError(400, 'Regras inválidas.'); o.rules = b.rules.map(r => str(r, 500)).filter(Boolean); }
  if (!partial || 'notes' in b) o.notes = str(b.notes, 4000);
  return o;
};
const dupBank = async (name, exceptId) => {
  const all = await db.collection('banks').find({}, { projection: { name: 1 } }).toArray();
  if (all.some(b => b.name.toLowerCase() === name.toLowerCase() && String(b._id) !== String(exceptId))) throw new HttpError(409, `Já existe um banco chamado "${name}".`);
};

app.post('/api/banks', needName, wrap(async (req, res) => {
  const o = bankFields(req.body, false); await dupBank(o.name);
  const last = await db.collection('banks').find().sort({ order: -1 }).limit(1).toArray();
  const doc = { ...o, order: (last[0]?.order ?? -1) + 1, rev: 1, createdAt: new Date(), updatedAt: new Date(), updatedBy: req.user.name };
  doc._id = (await db.collection('banks').insertOne(doc)).insertedId;
  await audit(req.user, [{ action: 'create', entity: 'banco', entityId: String(doc._id), entityName: doc.name, bankId: String(doc._id), bankName: doc.name, field: 'banco', old: null, new: doc.name }]);
  res.status(201).json({ doc, version: await bump() });
}));
app.put('/api/banks/:id', needName, wrap(async (req, res) => {
  const id = oid(req.params.id);
  const { rev, ...body } = req.body;
  const o = bankFields(body, true);
  if (o.name) await dupBank(o.name, id);
  const r = await updateDoc('banks', id, rev, o, req.user, { entity: 'banco', name: d => d.name, bankId: d => String(d._id), bankName: await bankName(id) });
  res.json({ doc: r.doc });
}));
app.delete('/api/banks/:id', needName, wrap(async (req, res) => {
  const id = oid(req.params.id);
  const b = await db.collection('banks').findOne({ _id: id });
  if (!b) throw new HttpError(404, 'Banco não encontrado.');
  const t = await db.collection('tables').deleteMany({ bankId: String(id) });
  const r = await db.collection('returns').deleteMany({ bankId: String(id) });
  await db.collection('banks').deleteOne({ _id: id });
  await audit(req.user, [{ action: 'delete', entity: 'banco', entityId: String(id), entityName: b.name, bankId: String(id), bankName: b.name, field: 'banco', old: `${b.name} (${t.deletedCount} tabelas, ${r.deletedCount} retornos)`, new: null }]);
  res.json({ ok: true, version: await bump() });
}));

/* ---------- tabelas ---------- */
const tableFields = (b, partial) => {
  const o = {};
  if (!partial || 'name' in b) o.name = str(b.name, 80, { required: true, field: 'Nome da tabela' });
  if (!partial || 'refPercent' in b) o.refPercent = pct(b.refPercent, 'Percentual de referência');
  if (!partial || 'goalPercent' in b) o.goalPercent = pct(b.goalPercent, 'Meta');
  if (!partial || 'installments' in b) o.installments = instMap(b.installments || {});
  if (!partial || 'notes' in b) o.notes = str(b.notes, 2000);
  if (!partial || 'active' in b) o.active = b.active !== false;
  return o;
};
const dupTable = async (bankId, name, exceptId) => {
  const all = await db.collection('tables').find({ bankId }, { projection: { name: 1 } }).toArray();
  if (all.some(t => t.name.toLowerCase() === name.toLowerCase() && String(t._id) !== String(exceptId))) throw new HttpError(409, `Este banco já possui uma tabela chamada "${name}".`);
};
const needBank = async idStr => { const b = await db.collection('banks').findOne({ _id: oid(idStr) }); if (!b) throw new HttpError(404, 'Banco não encontrado.'); return b; };

app.post('/api/tables', needName, wrap(async (req, res) => {
  const bank = await needBank(req.body.bankId);
  const o = tableFields(req.body, false); await dupTable(String(bank._id), o.name);
  const doc = { ...o, bankId: String(bank._id), rev: 1, createdAt: new Date(), updatedAt: new Date(), updatedBy: req.user.name };
  doc._id = (await db.collection('tables').insertOne(doc)).insertedId;
  await audit(req.user, [{ action: 'create', entity: 'tabela', entityId: String(doc._id), entityName: doc.name, bankId: doc.bankId, bankName: bank.name, field: 'tabela', old: null, new: doc.name }]);
  res.status(201).json({ doc, version: await bump() });
}));
app.put('/api/tables/:id', needName, wrap(async (req, res) => {
  const id = oid(req.params.id);
  const { rev, ...body } = req.body;
  const o = tableFields(body, true);
  const cur = await db.collection('tables').findOne({ _id: id });
  if (!cur) throw new HttpError(404, 'Tabela não encontrada.');
  if (o.name) await dupTable(cur.bankId, o.name, id);
  const r = await updateDoc('tables', id, rev, o, req.user, { entity: 'tabela', name: d => d.name, bankId: d => d.bankId, bankName: await bankName(oid(cur.bankId)) });
  res.json({ doc: r.doc });
}));
app.delete('/api/tables/:id', needName, wrap(async (req, res) => {
  const id = oid(req.params.id);
  const t = await db.collection('tables').findOne({ _id: id });
  if (!t) throw new HttpError(404, 'Tabela não encontrada.');
  await db.collection('tables').deleteOne({ _id: id });
  await audit(req.user, [{ action: 'delete', entity: 'tabela', entityId: String(id), entityName: t.name, bankId: t.bankId, bankName: await bankName(oid(t.bankId)), field: 'tabela', old: t.name, new: null }]);
  res.json({ ok: true, version: await bump() });
}));

/* ---------- retornos ---------- */
const retFields = (b, partial) => {
  const o = {};
  if (!partial || 'code' in b) o.code = str(b.code, 200, { required: true, field: 'Retorno/código' });
  if (!partial || 'meaning' in b) o.meaning = str(b.meaning, 2000, { required: true, field: 'Significado' });
  if (!partial || 'guidance' in b) o.guidance = str(b.guidance, 2000);
  return o;
};
app.post('/api/returns', needName, wrap(async (req, res) => {
  const bank = await needBank(req.body.bankId);
  const o = retFields(req.body, false);
  if (await db.collection('returns').findOne({ bankId: String(bank._id), code: o.code })) throw new HttpError(409, 'Este banco já possui um retorno com esse código/mensagem.');
  const doc = { ...o, bankId: String(bank._id), rev: 1, createdAt: new Date(), updatedAt: new Date(), updatedBy: req.user.name };
  doc._id = (await db.collection('returns').insertOne(doc)).insertedId;
  await audit(req.user, [{ action: 'create', entity: 'retorno', entityId: String(doc._id), entityName: doc.code, bankId: doc.bankId, bankName: bank.name, field: 'retorno', old: null, new: doc.code }]);
  res.status(201).json({ doc, version: await bump() });
}));
app.put('/api/returns/:id', needName, wrap(async (req, res) => {
  const id = oid(req.params.id);
  const { rev, ...body } = req.body;
  const o = retFields(body, true);
  const cur = await db.collection('returns').findOne({ _id: id });
  if (!cur) throw new HttpError(404, 'Retorno não encontrado.');
  if (o.code && await db.collection('returns').findOne({ bankId: cur.bankId, code: o.code, _id: { $ne: id } })) throw new HttpError(409, 'Já existe outro retorno com esse código/mensagem.');
  const r = await updateDoc('returns', id, rev, o, req.user, { entity: 'retorno', name: d => d.code, bankId: d => d.bankId, bankName: await bankName(oid(cur.bankId)) });
  res.json({ doc: r.doc });
}));
app.delete('/api/returns/:id', needName, wrap(async (req, res) => {
  const id = oid(req.params.id);
  const t = await db.collection('returns').findOne({ _id: id });
  if (!t) throw new HttpError(404, 'Retorno não encontrado.');
  await db.collection('returns').deleteOne({ _id: id });
  await audit(req.user, [{ action: 'delete', entity: 'retorno', entityId: String(id), entityName: t.code, bankId: t.bankId, bankName: await bankName(oid(t.bankId)), field: 'retorno', old: t.code, new: null }]);
  res.json({ ok: true, version: await bump() });
}));

/* ---------- configuração e histórico ---------- */
app.put('/api/settings', needName, wrap(async (req, res) => {
  if (!['percent', 'meta'].includes(req.body.rankCriterion)) throw new HttpError(400, 'Critério inválido.');
  const old = await db.collection('meta').findOne({ _id: 'settings' });
  await db.collection('meta').updateOne({ _id: 'settings' }, { $set: { rankCriterion: req.body.rankCriterion } }, { upsert: true });
  await audit(req.user, [{ action: 'update', entity: 'configuração', entityId: 'settings', entityName: 'Critério de classificação', bankId: null, bankName: '—', field: 'rankCriterion', old: old?.rankCriterion, new: req.body.rankCriterion }]);
  res.json({ version: await bump() });
}));
app.get('/api/audit', wrap(async (req, res) => {
  const q = {};
  if (req.query.bankId) q.bankId = String(req.query.bankId);
  if (req.query.q) { const rx = new RegExp(String(req.query.q).slice(0, 60).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'); q.$or = [{ entityName: rx }, { field: rx }, { bankName: rx }, { userName: rx }]; }
  const limit = Math.min(Number(req.query.limit) || 100, 500), skip = Math.max(Number(req.query.skip) || 0, 0);
  const [items, total] = await Promise.all([db.collection('audit_logs').find(q).sort({ at: -1 }).skip(skip).limit(limit).toArray(), db.collection('audit_logs').countDocuments(q)]);
  res.json({ items, total });
}));

/* ---------- erros ---------- */
app.use('/api', (req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));
app.use((err, req, res, next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, ...(err.extra || {}) });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON inválido.' });
  if (/Mongo(Server|Network)/.test(err.name || '') || /topology|ECONNREFUSED|timed out/i.test(err.message || '')) {
    console.error('Erro de conexão:', err.message); cache.p = null;
    return res.status(503).json({ error: 'Conexão com o banco de dados indisponível. A alteração NÃO foi salva — tente novamente.' });
  }
  console.error(err);
  res.status(500).json({ error: 'Erro interno do servidor.' });
});

module.exports = app;
if (require.main === module) app.listen(process.env.PORT || 3000, () => console.log('Rodando em http://localhost:' + (process.env.PORT || 3000)));
