(function() {
if (window.MAGYO_CLOUD_BRIDGE_ACTIVE) return;
window.MAGYO_CLOUD_BRIDGE_ACTIVE = true;
sessionStorage.removeItem('magyo_sw_booted');

if ('serviceWorker' in navigator) {
navigator.serviceWorker.register('./sw.js').catch(function() {});
}

const CFG_KEY = 'magyo_cloud_cfg_v1';
const SYNC_STATE_KEY = 'magyo_cloud_sync_state';
const STUDIO_META_KEY = 'magyo_cloud_studio_meta';
const DB_NAME = 'magyo_cloud_boot_db';
const STORE_NAME = 'kv';

const SYNC_KEYS = [
'magyo_studio_whitelist_v2',
'magyo_studio_custom_bans_v6',
'magyo_studio_user_suggest_v7',
'magyo_studio_lore_memo_v7',
'magyo_studio_master_doc_patch_v71',
'magyo_studio_radar_allow_v92',
'magyo_studio_tts_autobm_v93',
'magyo_studio_tts_pins_v93'
 ];
const IIFE_RELOAD_KEYS = new Set([
'magyo_studio_master_doc_patch_v71',
'magyo_studio_radar_allow_v92',
'magyo_studio_tts_autobm_v93',
'magyo_studio_tts_pins_v93'
 ]);

let deferredPwaPrompt = null;
window.addEventListener('beforeinstallprompt', function(e) {
e.preventDefault();
deferredPwaPrompt = e;
const instBtn = document.getElementById('mcBtnInstallApp');
if (instBtn) instBtn.style.display = 'inline-flex';
});

function utf8ToBase64(str) {
const bytes = new TextEncoder().encode(String(str || ''));
const chunks = [];
for (let i = 0; i < bytes.length; i += 0x8000) {
chunks.push(String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)));
}
return btoa(chunks.join(''));
}

function base64ToUtf8(b64) {
const bin = atob(String(b64 || '').replace(/\s+/g, ''));
const bytes = new Uint8Array(bin.length);
for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
return new TextDecoder('utf-8').decode(bytes);
}

// 휴대폰 3초 자동 연결 해시 처리
if (location.hash && location.hash.startsWith('#connect=')) {
try {
const parsed = JSON.parse(base64ToUtf8(decodeURIComponent(location.hash.slice('#connect='.length))));
history.replaceState(null, '', location.pathname);
if (parsed && parsed.token && parsed.owner && parsed.repo) {
localStorage.setItem(CFG_KEY, JSON.stringify({
token: parsed.token, owner: parsed.owner, repo: parsed.repo,
branch: parsed.branch || 'main', autoSync: true
}));
}
} catch (e) {}
}

function getCfg() {
try { return JSON.parse(localStorage.getItem(CFG_KEY) || 'null'); } catch (e) { return null; }
}
function saveCfg(c) {
localStorage.setItem(CFG_KEY, JSON.stringify(c));
}
function getSyncState() {
try { return JSON.parse(localStorage.getItem(SYNC_STATE_KEY) || '{}') || {}; } catch (e) { return {}; }
}
function setSyncState(patch) {
const next = Object.assign(getSyncState(), patch);
localStorage.setItem(SYNC_STATE_KEY, JSON.stringify(next));
return next;
}

function idbSet(key, val) {
return new Promise(function(resolve) {
try {
const req = indexedDB.open(DB_NAME, 1);
req.onupgradeneeded = function(e) {
const db = e.target.result;
if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
};
req.onsuccess = function(e) {
const db = e.target.result;
const tx = db.transaction(STORE_NAME, 'readwrite');
tx.objectStore(STORE_NAME).put(val, key);
tx.oncomplete = function() { db.close(); resolve(true); };
tx.onerror = function() { db.close(); resolve(false); };
};
req.onerror = function() { resolve(false); };
} catch (err) { resolve(false); }
});
}

function idbGet(key) {
return new Promise(function(resolve) {
try {
const req = indexedDB.open(DB_NAME, 1);
req.onupgradeneeded = function(e) {
const db = e.target.result;
if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
};
req.onsuccess = function(e) {
const db = e.target.result;
const tx = db.transaction(STORE_NAME, 'readonly');
const g = tx.objectStore(STORE_NAME).get(key);
g.onsuccess = function() { const v = g.result || null; db.close(); resolve(v); };
g.onerror = function() { db.close(); resolve(null); };
};
req.onerror = function() { resolve(null); };
} catch (err) { resolve(null); }
});
}

async function ghReq(cfg, path, opts) {
const o = opts || {};
const res = await fetch('https://api.github.com' + path, {
method: o.method || 'GET',
cache: 'no-store',
headers: {
'Authorization': 'Bearer ' + cfg.token.trim(),
'Accept': 'application/vnd.github+json',
'X-GitHub-Api-Version': '2022-11-28',
...(o.body ? { 'Content-Type': 'application/json' } : {})
},
body: o.body ? JSON.stringify(o.body) : undefined
});
const txt = await res.text();
let data = null;
try { data = txt ? JSON.parse(txt) : null; } catch (e) {}
return { ok: res.ok, status: res.status, data: data };
}

function fnv1aHash(str) {
let h = 0x811c9dc5;
for (let i = 0; i < str.length; i++) {
h ^= str.charCodeAt(i);
h = Math.imul(h, 0x01000193);
}
return (h >>> 0).toString(16);
}

function buildWorkspacePayload() {
let tabs = [];
let actIdx = 0;
try {
if (typeof fileTabs !== 'undefined' && Array.isArray(fileTabs)) {
tabs = fileTabs.map(function(t) {
return { id: t.id, name: t.name, text: t.text || '', hadCrlf: t.hadCrlf !== false };
});
}
if (typeof activeTabIdx !== 'undefined') actIdx = activeTabIdx;
} catch (e) {}

const syncedStorage = {};
SYNC_KEYS.forEach(function(k) {
const v = localStorage.getItem(k);
if (v !== null) syncedStorage[k] = v;
});

const isMob = /Android|iPhone|iPad/i.test(navigator.userAgent || '');
return {
schemaVersion: 1,
updatedAt: new Date().toISOString(),
updatedAtKr: new Date().toLocaleString('ko-KR', { hour12: false }),
device: isMob ? '모바일' : 'PC',
activeTabIdx: actIdx,
fileTabs: tabs,
syncedStorage: syncedStorage
};
}

function computeCurrentFingerprint() {
const p = buildWorkspacePayload();
const raw = JSON.stringify({ a: p.activeTabIdx, t: p.fileTabs, s: p.syncedStorage });
return fnv1aHash(raw) + ':' + raw.length;
}

function isWorkspaceCompletelyEmpty(payload) {
if (!payload || !Array.isArray(payload.fileTabs)) return true;
return payload.fileTabs.length === 1 && !(payload.fileTabs[0].text || '').trim();
}

let isBootReady = false;
let isSyncing = false;
let isDirty = false;
let lastSyncedFp = '';
let autoPushTimer = null;
let localCacheTimer = null;

function setCloudStatusUI(state, label) {
const dotColors = { ok: '#4ade80', dirty: '#facc15', sync: '#38bdf8', err: '#fb7185' };
const col = dotColors[state] || '#94a3b8';
const pcBtn = document.getElementById('mcBtnHeaderCloud');
if (pcBtn) {
pcBtn.innerHTML = <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${col};"></span> ☁️ ${label};
}
const mobBtn = document.getElementById('mcBtnMobCloud');
if (mobBtn) {
mobBtn.innerHTML = <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${col};"></span>☁️; } const modalStatus = document.getElementById('mcModalStatusLine'); if (modalStatus) modalStatus.textContent = label; } function applyWorkspaceToStudioLive(ws, allowReloadForIIFE) { if (!ws) return; let needIIFEReload = false; if (ws.syncedStorage && typeof ws.syncedStorage === 'object') { SYNC_KEYS.forEach(function(k) { if (ws.syncedStorage[k] !== undefined) { const prev = localStorage.getItem(k); if (prev !== ws.syncedStorage[k]) { localStorage.setItem(k, ws.syncedStorage[k]); if (IIFE_RELOAD_KEYS.has(k)) needIIFEReload = true; } } }); } if (allowReloadForIIFE && needIIFEReload) { location.reload(); return; } try { if (typeof loadPersistedData === 'function') loadPersistedData(); } catch (e) {} try { if (Array.isArray(ws.fileTabs) && ws.fileTabs.length &gt; 0 && typeof fileTabs !== 'undefined') { const restored = ws.fileTabs.map(function(t, idx) { return { id: t.id \vert{}\vert{} ('tab_' + Date.now() + '_' + idx), name: t.name \vert{}\vert{} ('원고_' + (idx + 1) + '.txt'), text: typeof t.text === 'string' ? t.text : '', handle: null, hadCrlf: t.hadCrlf !== false, undoStack: [], episodes: [], totalIssues: 0, totalMeta: 0 }; }); fileTabs.splice(0, fileTabs.length, ...restored); activeTabIdx = Math.max(0, Math.min(fileTabs.length - 1, Number(ws.activeTabIdx) \vert{}\vert{} 0)); if (typeof activeEditingLineIdx !== 'undefined') activeEditingLineIdx = null; const mEl = document.getElementById('masterText'); if (mEl && fileTabs[activeTabIdx]) mEl.value = fileTabs[activeTabIdx].text; if (typeof analyzeAllTabs === 'function') analyzeAllTabs(false); } } catch (e) {} lastSyncedFp = computeCurrentFingerprint(); isDirty = false; } // 서버로 원고 + 사전 + 개별 TXT 백업 일괄 커밋 window.mcPushToCloud = async function(reasonLabel, forceOverwrite) { const cfg = getCfg(); if (!cfg \vert{}\vert{} !cfg.token) { window.mcOpenModal(); if (typeof showToast === 'function') showToast('먼저 클라우드 연결 설정을 완료해 주세요.'); return false; } if (isSyncing) return false; try { if (typeof activeEditingLineIdx !== 'undefined' && activeEditingLineIdx !== null && typeof saveInlineEdit === 'function') { saveInlineEdit(activeEditingLineIdx); } } catch (e) {} const payload = buildWorkspacePayload(); await idbSet('cached_workspace', payload); isSyncing = true; clearTimeout(autoPushTimer); setCloudStatusUI('sync', '서버 저장 중...'); try { const ref = await ghReq(cfg,/repos/${cfg.owner}/${cfg.repo}/git/ref/heads/${encodeURIComponent(cfg.branch || 'main')}?_t=${Date.now()}); if (!ref.ok) throw new Error('서버 브랜치 조회 실패'); const remoteHeadSha = ref.data.object.sha; const commitRes = await ghReq(cfg,/repos/${cfg.owner}/${cfg.repo}/git/commits/${remoteHeadSha});
const treeRes = await ghReq(cfg, /repos/${cfg.owner}/${cfg.repo}/git/trees/${commitRes.data.tree.sha}); const remoteTree = (treeRes.data && treeRes.data.tree) \vert{}\vert{} []; const remoteWsItem = remoteTree.find(function(x) { return x.path === 'workspace.json'; }); const syncSt = getSyncState(); if (!forceOverwrite && remoteWsItem && syncSt.workspaceSha && remoteWsItem.sha !== syncSt.workspaceSha) { isSyncing = false; const chooseOverwrite = confirm( '⚠️ 다른 기기(PC 또는 휴대폰)에서 먼저 저장한 새 원고가 서버에 있습니다!\n\n' + '• [확인] : 지금 보고 있는 이 기기의 원고로 서버에 덮어쓰기 (이전 버전은 타임머신에 안전 보관됨)\n' + '• [취소] : 덮어쓰지 않고 멈추기 (클라우드 창에서 [서버 최신본 불러오기] 가능)' ); if (!chooseOverwrite) { setCloudStatusUI('dirty', '충돌 확인 필요'); return false; } isSyncing = true; } if (!forceOverwrite && remoteWsItem && isWorkspaceCompletelyEmpty(payload)) { isSyncing = false; setCloudStatusUI('ok', '빈 화면 보호됨'); return false; } const filesToCommit = [ { path: 'workspace.json', content: JSON.stringify(payload, null, 2) } ]; payload.fileTabs.forEach(function(t) { if (t.text && t.text.trim()) { let safeName = String(t.name \vert{}\vert{} '원고.txt').replace(/[\\/:*?"&lt;&gt;\vert{}]/g, '_').trim(); if (!/\.(txt\vert{}md)$/i.test(safeName)) safeName += '.txt'; filesToCommit.push({ path: 'manuscripts/' + safeName, content: t.text }); } }); const createdBlobs = await Promise.all(filesToCommit.map(function(f) { return ghReq(cfg, /repos/${cfg.owner}/${cfg.repo}/git/blobs, { method: 'POST', body: { content: utf8ToBase64(f.content), encoding: 'base64' } }).then(function(r) { if (!r.ok) throw new Error('데이터 업로드 실패'); return { path: f.path, mode: '100644', type: 'blob', sha: r.data.sha }; }); })); const newTree = await ghReq(cfg, /repos/${cfg.owner}/${cfg.repo}/git/trees, { method: 'POST', body: { base_tree: commitRes.data.tree.sha, tree: createdBlobs } }); const wsBlobObj = createdBlobs.find(function(b) { return b.path === 'workspace.json'; }); if (newTree.data.sha === commitRes.data.tree.sha) { setSyncState({ headSha: remoteHeadSha, workspaceSha: wsBlobObj ? wsBlobObj.sha : syncSt.workspaceSha }); lastSyncedFp = computeCurrentFingerprint(); isDirty = false; setCloudStatusUI('ok', '동기화됨'); isSyncing = false; if (reasonLabel && reasonLabel.includes('수동') && typeof showToast === 'function') { showToast('☁️ 서버와 이미 똑같은 최신 상태입니다!'); } return true; } const msg = 💾 ${reasonLabel || '클라우드 저장'} (${payload.device} ·${payload.fileTabs.length}개 탭 · ${payload.updatedAtKr}); const newCommit = await ghReq(cfg, /repos/${cfg.owner}/${cfg.repo}/git/commits, { method: 'POST', body: { message: msg, tree: newTree.data.sha, parents: [remoteHeadSha] } }); await ghReq(cfg, /repos/${cfg.owner}/${cfg.repo}/git/refs/heads/${encodeURIComponent(cfg.branch || 'main')}`, {
method: 'PATCH',
body: { sha: newCommit.data.sha, force: false }
});

setSyncState({
headSha: newCommit.data.sha,
workspaceSha: wsBlobObj ? wsBlobObj.sha : ''
});
lastSyncedFp = computeCurrentFingerprint();
isDirty = false;
const nowShort = new Date().toTimeString().slice(0, 5);
setCloudStatusUI('ok', '저장됨 ' + nowShort);

if (reasonLabel && reasonLabel.includes('수동') && typeof showToast === 'function') {
showToast(☁️ 비공개 서버 저장 완료! (${payload.fileTabs.length}개 원고 탭 · 사전 · 이어듣기 동기화됨)); } isSyncing = false; return true; } catch (err) { isSyncing = false; setCloudStatusUI('err', '저장 실패'); if (typeof showToast === 'function') showToast('❌ 클라우드 저장 오류: ' + (err.message \vert{}\vert{} err)); return false; } }; // 서버에서 최신 원고 및 새 스튜디오(.html) 업데이트 확인·불러오기 window.mcPullFromCloud = async function(isManual) { const cfg = getCfg(); if (!cfg \vert{}\vert{} !cfg.token \vert{}\vert{} isSyncing) return; isSyncing = true; if (isManual) setCloudStatusUI('sync', '불러오는 중...'); try { const ref = await ghReq(cfg,/repos/{cfg.repo}/git/ref/heads/{Date.now()}); if (!ref.ok) throw new Error('서버 응답 오류'); const remoteHeadSha = ref.data.object.sha; const syncSt = getSyncState(); if (!isManual && syncSt.headSha === remoteHeadSha) { setCloudStatusUI(isDirty ? 'dirty' : 'ok', isDirty ? '미저장 변경' : '동기화됨'); isSyncing = false; return; } const commitRes = await ghReq(cfg,/repos/{cfg.repo}/git/commits/{cfg.owner}/{commitRes.data.tree.sha}); const tree = (treeRes.data && treeRes.data.tree) \vert{}\vert{} []; const studioItem = tree.find(function(x) { return x.path === 'studio_app.html'; }); const metaItem = tree.find(function(x) { return x.path === 'studio_meta.json'; }); const wsItem = tree.find(function(x) { return x.path === 'workspace.json'; }); let studioUpdated = false; if (studioItem && studioItem.sha !== syncSt.studioSha) { const sBlob = await ghReq(cfg,/repos/{cfg.repo}/git/blobs/latex
{studioItem.sha}`); if (sBlob.ok && sBlob.data) { await idbSet('active_studio_html', base64ToUtf8(sBlob.data.content)); studioUpdated = true; } if (metaItem) { const mBlob = await ghReq(cfg, `/repos/

{cfg.owner}/{metaItem.sha}); if (mBlob.ok && mBlob.data) localStorage.setItem(STUDIO_META_KEY, base64ToUtf8(mBlob.data.content)); } } if (wsItem && (isManual \vert{}\vert{} wsItem.sha !== syncSt.workspaceSha)) { if (!isManual && isDirty) { isSyncing = false; setCloudStatusUI('dirty', '타기기 새버전 감지'); if (typeof showToast === 'function') { showToast('⚠️ 다른 기기에서 저장된 새 원고가 있습니다! 상단 [☁️] 버튼을 눌러 확인하세요.'); } return; } const wsBlob = await ghReq(cfg,/repos/{cfg.repo}/git/blobs/latex
{wsItem.sha}`); if (wsBlob.ok && wsBlob.data) { const ws = JSON.parse(base64ToUtf8(wsBlob.data.content)); await idbSet('cached_workspace', ws); setSyncState({ headSha: remoteHeadSha, studioSha: studioItem ? studioItem.sha : syncSt.studioSha, workspaceSha: wsItem.sha }); isSyncing = false; if (studioUpdated) { if (typeof showToast === 'function') showToast('🚀 새 스튜디오 버전과 최신 원고를 적용합니다...'); setTimeout(function() { location.reload(); }, 350); return; } applyWorkspaceToStudioLive(ws, true); setCloudStatusUI('ok', '최신 반영됨'); if (typeof showToast === 'function') { showToast(`☁️ 서버 최신 원고(

{ws.device \vert{}\vert{} ''} ·${ws.updatedAtKr || ''})를 불러왔습니다!);
}
return;
}
}

setSyncState({
headSha: remoteHeadSha,
studioSha: studioItem ? studioItem.sha : syncSt.studioSha,
workspaceSha: wsItem ? wsItem.sha : syncSt.workspaceSha
});
isSyncing = false;

if (studioUpdated) {
if (typeof showToast === 'function') showToast('🚀 새 스튜디오 앱 업데이트가 감지되어 재시작합니다!');
setTimeout(function() { location.reload(); }, 400);
return;
}
setCloudStatusUI(isDirty ? 'dirty' : 'ok', isDirty ? '미저장 변경' : '동기화됨');
if (isManual && typeof showToast === 'function') showToast('☁️ 이미 서버의 최신 원고와 일치합니다.');
} catch (err) {
isSyncing = false;
setCloudStatusUI('err', '오프라인');
if (isManual && typeof showToast === 'function') showToast('❌ 불러오기 실패: ' + (err.message || err));
}
};

// 앱 안에서 스튜디오 새 버전(.html) 업로드하여 업데이트
window.mcUploadStudioHtmlUpdate = async function(file) {
if (!file) return;
const cfg = getCfg();
if (!cfg || !cfg.token) {
if (typeof showToast === 'function') showToast('먼저 클라우드 연결을 설정해 주세요.');
return;
}
if (!/.(html|htm)`$/i.test(file.name)) {
alert('⚠️ 원고(.txt)가 아닌 스튜디오 앱 업데이트 파일(.html)을 선택해 주세요!');
return;
}
const buf = await file.arrayBuffer();
const html = new TextDecoder('utf-8').decode(buf);
if (!/<html/i.test(html) || !/<script/i.test(html) || (!html.includes('masterText') && !html.includes('퇴고 스튜디오'))) {
if (!confirm('선택한 HTML 파일에서 스튜디오 기본 구조가 감지되지 않았습니다. 그래도 앱 본체로 업데이트하시겠습니까?')) return;
}

const progEl = document.getElementById('mcUpdateProgressText');
if (progEl) progEl.textContent = ⏳ 현재 작업 중인 원고를 안전 백업한 뒤 '${file.name}' 버전을 업로드하고 있습니다...; if (isDirty) { await window.mcPushToCloud('앱 버전 업데이트 직전 자동 백업', true); } else { await idbSet('cached_workspace', buildWorkspacePayload()); } try { isSyncing = true; const nowKr = new Date().toLocaleString('ko-KR', { hour12: false }); const metaJson = JSON.stringify({ fileName: file.name, updatedAt: nowKr, size: html.length }); const ref = await ghReq(cfg,/repos/${cfg.owner}/${cfg.repo}/git/ref/heads/${encodeURIComponent(cfg.branch || 'main')}?_t=${Date.now()}); const headSha = ref.data.object.sha; const commitRes = await ghReq(cfg,/repos/${cfg.owner}/${cfg.repo}/git/commits/${headSha});

const [bStudio, bMeta] = await Promise.all([
ghReq(cfg, /repos/${cfg.owner}/${cfg.repo}/git/blobs, { method: 'POST', body: { content: utf8ToBase64(html), encoding: 'base64' } }),
ghReq(cfg, /repos/${cfg.owner}/${cfg.repo}/git/blobs, { method: 'POST', body: { content: utf8ToBase64(metaJson), encoding: 'base64' } })
 ]);

const newTree = await ghReq(cfg, /repos/${cfg.owner}/${cfg.repo}/git/trees, {
method: 'POST',
body: {
base_tree: commitRes.data.tree.sha,
tree: [
{ path: 'studio_app.html', mode: '100644', type: 'blob', sha: bStudio.data.sha },
{ path: 'studio_meta.json', mode: '100644', type: 'blob', sha: bMeta.data.sha }
 ]
}
});

const newCommit = await ghReq(cfg, /repos/${cfg.owner}/${cfg.repo}/git/commits, {
method: 'POST',
body: { message: 🚀 스튜디오 앱 업데이트: ${file.name} (${nowKr}), tree: newTree.data.sha, parents: [headSha] }
});

await ghReq(cfg, /repos/${cfg.owner}/${cfg.repo}/git/refs/heads/${encodeURIComponent(cfg.branch \vert{}\vert{} 'main')}, { method: 'PATCH', body: { sha: newCommit.data.sha, force: false } }); await idbSet('active_studio_html', html); localStorage.setItem(STUDIO_META_KEY, metaJson); setSyncState({ headSha: newCommit.data.sha, studioSha: bStudio.data.sha }); isSyncing = false; if (typeof showToast === 'function') showToast(🎉 '${file.name}' 업데이트 완료! 새 버전으로 재시작합니다.);
setTimeout(function() { location.reload(); }, 450);
} catch (err) {
isSyncing = false;
if (progEl) progEl.textContent = '❌ 업데이트 실패: ' + (err.message || err);
}
};

// 타임머신 백업 기록 조회 및 복구
window.mcLoadTimeMachine = async function() {
const box = document.getElementById('mcTimeMachineList');
const cfg = getCfg();
if (!box || !cfg || !cfg.token) return;
box.innerHTML = '<div style="padding:10px; color:#7dd3fc; font-size:0.8rem;">⏳ 서버 백업 기록을 불러오는 중...</div>';

try {
const res = await ghReq(cfg, /repos/${cfg.owner}/${cfg.repo}/commits?sha=${encodeURIComponent(cfg.branch \vert{}\vert{} 'main')}&per_page=20&_t=${Date.now()});
if (!res.ok || !Array.isArray(res.data) || !res.data.length) {
box.innerHTML = '<div style="padding:10px; color:#94a3b8;">아직 저장된 백업 기록이 없습니다.</div>';
return;
}
box.innerHTML = res.data.map(function(c) {
const dt = new Date(c.commit.committer.date).toLocaleString('ko-KR', { hour12: false });
const msg = (c.commit.message || '').split('\n')[0];
const sha = c.sha;
const isAppUpd = msg.includes('🚀');
return <div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:6px;padding:8px 10px;border-bottom:1px solid #1e293b;font-size:0.78rem;"&gt; &lt;div style="min-width:0;flex:1;"&gt; &lt;div style="font-weight:700;color:#e2e8f0;"&gt;${msg.replace(/</g, '<')}</div>
<div style="color:#94a3b8;font-size:0.73rem;">${dt} · #${sha.slice(0, 7)}</div>
</div>
<div style="display:flex;gap:5px;">
<button type="button" class="btn btn-xs btn-teal" onclick="mcRestoreCommit('${sha}', 'workspace', '${dt}')">📄 원고복구</button>
${isAppUpd ?<button type="button" class="btn btn-xs btn-purple" onclick="mcRestoreCommit('{dt}')">⚙️ 앱버전복구</button>: ''} &lt;/div&gt; &lt;/div>;
}).join('');
} catch (e) {
box.innerHTML = '<div style="padding:10px; color:#fb7185;">백업 기록 조회 실패</div>';
}
};

window.mcRestoreCommit = async function(commitSha, targetType, dateLabel) {
const cfg = getCfg();
if (!cfg) return;
const label = targetType === 'studio' ? '스튜디오 앱(.html) 버전' : '원고 및 사전 데이터';
if (!confirm(⏪ [${dateLabel}] 시점의 ${label}으로 복구하시겠습니까?)) return;

try {
const cRes = await ghReq(cfg, /repos/${cfg.owner}/${cfg.repo}/git/commits/${commitSha}); const tRes = await ghReq(cfg,/repos/${cfg.owner}/${cfg.repo}/git/trees/${cRes.data.tree.sha});
const tree = (tRes.data && tRes.data.tree) || [];

if (targetType === 'studio') {
const sItem = tree.find(function(x) { return x.path === 'studio_app.html'; });
if (!sItem) { alert('해당 시점에는 스튜디오 앱 파일이 없습니다.'); return; }
const bRes = await ghReq(cfg, /repos/${cfg.owner}/${cfg.repo}/git/blobs/${sItem.sha}); const html = base64ToUtf8(bRes.data.content); const f = new File([html],복구본_${dateLabel.replace(/[^0-9]/g, '')}.html, { type: 'text/html' });
await window.mcUploadStudioHtmlUpdate(f);
} else {
const wItem = tree.find(function(x) { return x.path === 'workspace.json'; });
if (!wItem) { alert('해당 시점에는 저장된 원고 데이터가 없습니다.'); return; }
const bRes = await ghReq(cfg, /repos/${cfg.owner}/${cfg.repo}/git/blobs/${wItem.sha}); const ws = JSON.parse(base64ToUtf8(bRes.data.content)); await idbSet('cached_workspace', ws); applyWorkspaceToStudioLive(ws, false); await window.mcPushToCloud(타임머신 복구 (${dateLabel} 시점), true);
location.reload();
}
} catch (err) {
alert('복구 중 오류 발생: ' + (err.message || err));
}
};

// 변경 감지 및 자동 백업 스케줄러
function scheduleDirtyCheck(delayPushMs) {
if (!isBootReady) return;
clearTimeout(localCacheTimer);
localCacheTimer = setTimeout(async function() {
const fp = computeCurrentFingerprint();
if (fp === lastSyncedFp) return;
isDirty = true;
setCloudStatusUI('dirty', '미저장 변경');
await idbSet('cached_workspace', buildWorkspacePayload());

const cfg = getCfg();
if (cfg && cfg.autoSync !== false) {
clearTimeout(autoPushTimer);
autoPushTimer = setTimeout(function() {
window.mcPushToCloud('자동 동기화', false);
}, delayPushMs || 10000);
}
}, 500);
}

const origSetItem = Storage.prototype.setItem;
Storage.prototype.setItem = function(k, v) {
origSetItem.call(this, k, v);
if (!isBootReady || !SYNC_KEYS.includes(k)) return;
if (k === 'magyo_studio_tts_autobm_v93') {
const playBtn = document.getElementById('v93BtnPlayMain');
const isPlayingNow = playBtn && playBtn.classList.contains('is-playing');
if (!isPlayingNow) scheduleDirtyCheck(3500);
return;
}
scheduleDirtyCheck(8000);
};

// 스튜디오 핵심 편집·저장 함수 후킹 (Ctrl+S -> 비공개 서버 저장 직결)
['analyzeSingleTabOnly', 'analyzeAllTabs', 'fastUpdateSingleLineInTab', 'switchFileTab'].forEach(function(fnName) {
if (typeof window[fnName] === 'function') {
const orig = window[fnName];
window[fnName] = function() {
const r = orig.apply(this, arguments);
scheduleDirtyCheck(10000);
return r;
};
}
});

['v93TtsPause', 'v93TtsStop'].forEach(function(fnName) {
if (typeof window[fnName] === 'function') {
const orig = window[fnName];
window[fnName] = function() {
const r = orig.apply(this, arguments);
scheduleDirtyCheck(2500);
return r;
};
}
});

function syncSaveButtonLabels() {
const saveBtn = document.getElementById('btnSaveMain');
if (saveBtn) {
let hasHandle = false;
try { hasHandle = Boolean(typeof getActiveTab === 'function' && getActiveTab() && getActiveTab().handle); } catch (e) {}
saveBtn.textContent = hasHandle ? '☁️ 서버+파일 저장' : '☁️ 서버 저장';
saveBtn.title = '단축키 Ctrl+S : 모든 원고 탭·사전·이어듣기 위치를 비공개 서버에 즉시 저장합니다';
}
const mobSaveBtn = document.querySelector('#mobQuickHeaderBar button[onclick*="saveCurrentText"]');
if (mobSaveBtn) mobSaveBtn.innerHTML = '☁️ 저장';
}

if (typeof window.updateFileLinkUI === 'function') {
const origLinkUI = window.updateFileLinkUI;
window.updateFileLinkUI = updateFileLinkUI = function() {
origLinkUI.apply(this, arguments);
syncSaveButtonLabels();
};
}

if (typeof window.saveCurrentText === 'function') {
window.saveCurrentText = saveCurrentText = async function() {
try {
if (typeof activeEditingLineIdx !== 'undefined' && activeEditingLineIdx !== null && typeof saveInlineEdit === 'function') {
saveInlineEdit(activeEditingLineIdx);
}
const tab = typeof getActiveTab === 'function' ? getActiveTab() : null;
if (tab && tab.text && tab.text.trim() && typeof confirmMetaBeforeExport === 'function') {
if (!confirmMetaBeforeExport('서버 원고 저장', [tab])) return;
}
if (tab && tab.handle && typeof getSerializedTabText === 'function') {
try {
const w = await tab.handle.createWritable();
await w.write(getSerializedTabText(tab));
await w.close();
} catch (e) {}
}
} catch (e) {}
await window.mcPushToCloud('수동 저장 (Ctrl+S)', false);
};
}

window.addEventListener('beforeunload', function(e) {
if (isDirty) {
e.preventDefault();
e.returnValue = '';
}
});

document.addEventListener('visibilitychange', function() {
if (document.hidden && isDirty) {
idbSet('cached_workspace', buildWorkspacePayload());
const cfg = getCfg();
if (cfg && cfg.autoSync !== false) window.mcPushToCloud('화면 전환 자동 백업', false);
} else if (!document.hidden && isBootReady) {
window.mcPullFromCloud(false);
}
});

// 클라우드 센터 UI & 모달 주입
function injectCloudUI() {
const topRight = document.getElementById('v88TopRight');
const saveMain = document.getElementById('btnSaveMain');
if (topRight && !document.getElementById('mcBtnHeaderCloud')) {
const cBtn = document.createElement('button');
cBtn.type = 'button';
cBtn.id = 'mcBtnHeaderCloud';
cBtn.className = 'btn';
cBtn.innerHTML = '☁️ 클라우드';
cBtn.title = '비공개 서버 동기화 · 앱 버전(.html) 업데이트 · 타임머신 복구';
cBtn.onclick = function() { window.mcOpenModal(); };
topRight.insertBefore(cBtn, saveMain || topRight.firstChild);
}

const mobRight = document.getElementById('mobTopRightBtns');
if (mobRight && !document.getElementById('mcBtnMobCloud')) {
const mBtn = document.createElement('button');
mBtn.type = 'button';
mBtn.id = 'mcBtnMobCloud';
mBtn.className = 'btn btn-xs';
mBtn.style.cssText = 'padding:3px 7px; font-size:0.72rem;';
mBtn.innerHTML = '☁️';
mBtn.onclick = function() { window.mcOpenModal(); };
mobRight.insertBefore(mBtn, mobRight.firstChild);
}

syncSaveButtonLabels();

const backdrop = document.createElement('div');
backdrop.id = 'mcModalBackdrop';
backdrop.className = 'gdoc-modal-backdrop';
backdrop.onclick = function(e) { if (e.target === backdrop) window.mcCloseModal(); };
backdrop.innerHTML = `
<div class="gdoc-modal" style