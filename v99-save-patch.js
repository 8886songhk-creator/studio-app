/**
 * 스튜디오 클라우드 v9.9 패치: 통합 저장(기기+서버 원클릭 연동) & 미저장 닫기/덮어쓰기 방지
 * 적용 방법:
 *   방법 A) 이 파일(v99-save-patch.js)을 GitHub 저장소에 업로드한 뒤,
 *          index.html의 </body> 바로 위에 <script src="./v99-save-patch.js"></script> 한 줄 추가
 *   방법 B) 이 파일의 전체 내용을 index.html의 </body> 바로 위에 <script> ... </script>로 붙여넣기
 */
(function () {
  if (window.__v99UnifiedSaveLoaded) return;
  window.__v99UnifiedSaveLoaded = true;

  const STORAGE_GUARD_KEY = 'v99_unsaved_guard_meta';
  const LOAD_GRACE_MS = 3500;
  const CHAIN_DELAY_MS = 350;

  let isDirty = false;
  let isSaving = false;
  let isAutoChaining = false;
  let suppressDirtyUntil = Date.now() + LOAD_GRACE_MS;
  let historyGuardArmed = false;
  let bypassPopstateOnce = false;
  let activeSaveRequests = 0;
  let viewerSnapshot = '';

  /* =========================================================
     1. 스타일 주입 (상태 배지, 토스트, 닫기 경고 모달, 복구 배너)
     ========================================================= */
  const styleEl = document.createElement('style');
  styleEl.id = 'v99-save-patch-style';
  styleEl.textContent = `
    .v99-save-pill {
      position: fixed;
      top: 62px;
      right: 122px;
      z-index: 9990;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 7px 12px;
      border-radius: 999px;
      font-size: 12.5px;
      font-weight: 600;
      cursor: pointer;
      user-select: none;
      backdrop-filter: blur(6px);
      -webkit-tap-highlight-color: transparent;
      transition: all 0.2s ease;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.22);
      background: rgba(24, 28, 36, 0.78);
      color: #cbd5e1;
      border: 1px solid rgba(255, 255, 255, 0.16);
    }
    .v99-save-pill.dirty {
      background: rgba(180, 83, 9, 0.94);
      color: #ffffff;
      border-color: #fbbf24;
      box-shadow: 0 4px 16px rgba(245, 158, 11, 0.4);
    }
    .v99-save-pill.saving {
      background: rgba(37, 99, 235, 0.92);
      color: #ffffff;
      border-color: #93c5fd;
    }
    @media (max-width: 420px) {
      .v99-save-pill {
        top: 62px;
        right: 116px;
        padding: 6px 10px;
        font-size: 11.5px;
      }
    }
    .v99-toast {
      position: fixed;
      left: 50%;
      bottom: 54px;
      transform: translateX(-50%);
      z-index: 10002;
      background: rgba(15, 23, 42, 0.94);
      color: #ffffff;
      padding: 9px 16px;
      border-radius: 999px;
      font-size: 12.5px;
      font-weight: 600;
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.2s ease;
      box-shadow: 0 6px 18px rgba(0, 0, 0, 0.38);
      white-space: nowrap;
      max-width: calc(100vw - 28px);
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .v99-toast.show { opacity: 1; }
    .v99-banner {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      z-index: 10001;
      background: #991b1b;
      color: #ffffff;
      padding: 10px 14px;
      font-size: 12.5px;
      line-height: 1.45;
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
      justify-content: space-between;
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
    }
    .v99-banner-actions {
      display: flex;
      gap: 6px;
      flex-shrink: 0;
    }
    .v99-btn {
      border: none;
      border-radius: 7px;
      padding: 6px 11px;
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
    }
    .v99-btn.primary { background: #fbbf24; color: #111827; }
    .v99-btn.ghost { background: rgba(255, 255, 255, 0.18); color: #ffffff; }
    .v99-modal-backdrop {
      position: fixed;
      inset: 0;
      z-index: 10005;
      background: rgba(0, 0, 0, 0.62);
      display: none;
      align-items: center;
      justify-content: center;
      padding: 18px;
    }
    .v99-modal-backdrop.open { display: flex; }
    .v99-modal {
      background: #1e293b;
      color: #f8fafc;
      border: 1px solid rgba(255, 255, 255, 0.16);
      border-radius: 14px;
      max-width: 360px;
      width: 100%;
      padding: 18px;
      box-shadow: 0 16px 36px rgba(0, 0, 0, 0.5);
    }
    .v99-modal h3 {
      margin: 0 0 8px;
      font-size: 15.5px;
      color: #fbbf24;
    }
    .v99-modal p {
      margin: 0 0 15px;
      font-size: 13px;
      line-height: 1.5;
      color: #cbd5e1;
    }
    .v99-modal-btns {
      display: flex;
      flex-direction: column;
      gap: 7px;
    }
    .v99-modal-btns button {
      padding: 10px;
      border-radius: 9px;
      border: none;
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
    }
    .v99-mbtn-save { background: #2563eb; color: #ffffff; }
    .v99-mbtn-stay { background: #334155; color: #f1f5f9; }
    .v99-mbtn-exit { background: transparent; color: #94a3b8; border: 1px solid rgba(148,163,184,0.3) !important; }
  `;
  (document.head || document.documentElement).appendChild(styleEl);

  /* =========================================================
     2. 유틸리티 및 스튜디오 내 저장/서버저장 버튼 탐색
     ========================================================= */
  let toastEl = null;
  let toastTimer = null;
  let pillEl = null;

  function showToast(msg, durationMs) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'v99-toast';
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), durationMs || 2200);
  }

  function cleanLabel(el) {
    const raw = (el.textContent || el.getAttribute('aria-label') || el.title || '').trim();
    return raw.replace(/[^\uAC00-\uD7A3a-zA-Z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
  }

  function isVisible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    if (el.closest('.v99-banner, .v99-modal-backdrop, .v99-save-pill')) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function findStudioButtons() {
    const candidates = Array.from(
      document.querySelectorAll('button, [role="button"], a[onclick], input[type="button"]')
    ).filter(el => !el.classList.contains('v99-save-pill') && !el.closest('.v99-modal, .v99-banner'));

    let serverBtn = null;
    let localBtn = null;
    const visibleCandidates = candidates.filter(isVisible);
    const pool = visibleCandidates.length ? visibleCandidates : candidates;

    // 1) 서버 저장 버튼 탐색
    for (const el of pool) {
      const label = cleanLabel(el);
      const onclick = (el.getAttribute('onclick') || '') + ' ' + (el.id || '');
      if (
        /^(서버\s*저장|클라우드\s*저장|드라이브\s*저장|서버에\s*저장|서버\s*동기화|서버\s*업로드)(하기)?$/.test(label) ||
        /serverSave|saveToServer|cloudSave|syncToServer|uploadToCloud|saveCloud/i.test(onclick)
      ) {
        serverBtn = el;
        break;
      }
    }
    if (!serverBtn) {
      serverBtn = pool.find(el => /서버\s*저장|클라우드\s*저장/.test(cleanLabel(el))) || null;
    }

    // 2) 일반(기기) 저장 버튼 탐색 (설정/키/파일 다운로드 제외)
    const localMatches = pool.filter(el => {
      if (el === serverBtn) return false;
      const label = cleanLabel(el);
      const onclick = (el.getAttribute('onclick') || '') + ' ' + (el.id || '');
      if (/파일|다운로드|내보내기|TXT|백업|키|설정|프롬프트|API/i.test(label)) return false;
      if (/download|export/i.test(onclick)) return false;
      return /^(저장|임시\s*저장|로컬\s*저장|브라우저\s*저장)(하기)?$/.test(label);
    });

    if (localMatches.length > 1 && serverBtn && serverBtn.parentElement) {
      // 서버 저장 버튼과 같은 툴바에 있는 저장 버튼 우선 선택
      localBtn =
        localMatches.find(el => el.parentElement === serverBtn.parentElement) ||
        localMatches[0];
    } else {
      localBtn = localMatches[0] || null;
    }

    return { localBtn, serverBtn };
  }

  function isServerLoadButton(el) {
    if (!el) return false;
    const label = cleanLabel(el);
    const onclick = (el.getAttribute('onclick') || '') + ' ' + (el.id || '');
    return (
      /서버\s*불러오기|클라우드\s*불러오기|드라이브\s*불러오기|서버에서\s*불러오기|원본\s*불러오기/.test(label) ||
      /loadFromServer|serverLoad|cloudLoad|fetchFromServer/i.test(onclick)
    );
  }

  function isAnyLoadTrigger(el) {
    if (!el) return false;
    const label = cleanLabel(el);
    return /불러오기|파일\s*열기|원고\s*열기|초기화/.test(label);
  }

  /* =========================================================
     3. 미저장 상태 표시 업데이트 및 뒤로가기 가드
     ========================================================= */
  function armHistoryGuard() {
    if (historyGuardArmed) return;
    try {
      history.pushState({ v99UnsavedGuard: true }, '');
      historyGuardArmed = true;
    } catch (e) {}
  }

  function updateSaveUI() {
    if (!pillEl) return;
    pillEl.classList.remove('dirty', 'saving');
    if (isSaving) {
      pillEl.classList.add('saving');
      pillEl.textContent = '⏳ 서버 저장 중...';
    } else if (isDirty) {
      pillEl.classList.add('dirty');
      pillEl.textContent = '🟠 미저장 · 통합저장';
    } else {
      pillEl.textContent = '☁️ 저장됨';
    }
  }

  function markDirty(reason) {
    if (Date.now() < suppressDirtyUntil || isSaving) return;
    if (!isDirty) {
      isDirty = true;
      armHistoryGuard();
    }
    try {
      localStorage.setItem(
        STORAGE_GUARD_KEY,
        JSON.stringify({ ts: Date.now(), reason: reason || 'edit' })
      );
    } catch (e) {}
    updateSaveUI();
  }

  function markClean() {
    isDirty = false;
    isSaving = false;
    try {
      localStorage.removeItem(STORAGE_GUARD_KEY);
    } catch (e) {}
    const existingBanner = document.getElementById('v99-recovery-banner');
    if (existingBanner) existingBanner.remove();
    updateSaveUI();
  }

  /* =========================================================
     4. 네트워크 요청 감시 (서버 저장 성공/실패 판별)
     ========================================================= */
  let saveFinishTimer = null;

  function beginServerSaveWatch() {
    isSaving = true;
    updateSaveUI();
    clearTimeout(saveFinishTimer);
    // 비네트워크/외부 SDK 저장일 경우를 대비한 기본 완료 타이머
    saveFinishTimer = setTimeout(() => {
      if (activeSaveRequests === 0 && isSaving) {
        markClean();
        showToast('✅ 기기 저장 및 서버 저장이 완료되었습니다');
      }
    }, 1100);
  }

  function onServerRequestFailed(msg) {
    isSaving = false;
    isDirty = true;
    clearTimeout(saveFinishTimer);
    updateSaveUI();
    showToast('⚠️ 서버 저장 실패: ' + (msg || '네트워크 상태를 확인해 주세요'), 3200);
  }

  const origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    window.fetch = function () {
      const watching = isSaving;
      if (watching) {
        activeSaveRequests++;
        clearTimeout(saveFinishTimer);
      }
      return origFetch.apply(this, arguments).then(
        (res) => {
          if (watching) {
            activeSaveRequests = Math.max(0, activeSaveRequests - 1);
            if (!res.ok && res.status >= 400) {
              onServerRequestFailed('응답 오류 (' + res.status + ')');
            } else if (activeSaveRequests === 0 && isSaving) {
              markClean();
              showToast('✅ 기기 저장 및 서버 저장이 완료되었습니다');
            }
          }
          return res;
        },
        (err) => {
          if (watching) {
            activeSaveRequests = Math.max(0, activeSaveRequests - 1);
            onServerRequestFailed('연결 끊김');
          }
          throw err;
        }
      );
    };
  }

  /* =========================================================
     5. 원클릭 통합 저장 실행 (저장 -> 서버 저장 자동 연쇄)
     ========================================================= */
  function triggerUnifiedSave(fromLocalBtnClick) {
    const { localBtn, serverBtn } = findStudioButtons();

    if (!fromLocalBtnClick && localBtn) {
      isAutoChaining = true;
      try {
        localBtn.click();
      } finally {
        isAutoChaining = false;
      }
    }

    if (!serverBtn) {
      if (fromLocalBtnClick || localBtn) {
        markClean();
        showToast('💾 저장 완료 (화면에서 서버 저장 버튼을 찾지 못했습니다)');
      } else {
        showToast('⚠️ 현재 화면에서 저장 버튼을 찾을 수 없습니다');
      }
      return;
    }

    if (!navigator.onLine) {
      isSaving = false;
      isDirty = true;
      updateSaveUI();
      showToast('💾 기기 저장 완료! (현재 오프라인이라 서버 저장은 보류됨)', 3000);
      return;
    }

    setTimeout(() => {
      isAutoChaining = true;
      beginServerSaveWatch();
      try {
        serverBtn.click();
      } finally {
        isAutoChaining = false;
      }
    }, fromLocalBtnClick ? CHAIN_DELAY_MS : 250);
  }

  // 기존 '저장' 및 '서버 저장' 버튼 클릭 가로채기/연동
  document.addEventListener('click', function (e) {
    if (isAutoChaining) return;
    const btn = e.target && e.target.closest
      ? e.target.closest('button, [role="button"], a[onclick], input[type="button"]')
      : null;
    if (!btn) return;

    // 미저장 상태에서 '서버 불러오기' 클릭 시 덮어쓰기 방지 경고
    if (isServerLoadButton(btn)) {
      const hasUnsavedRecord = isDirty || !!localStorage.getItem(STORAGE_GUARD_KEY);
      if (hasUnsavedRecord) {
        const ok = window.confirm(
          '⚠️ 아직 서버에 저장하지 않은 작업 내역이 있습니다.\n지금 서버에서 불러오면 수정한 원고가 예전 버전으로 덮어써질 수 있습니다.\n\n그래도 서버 파일로 덮어쓰시겠습니까?'
        );
        if (!ok) {
          e.stopImmediatePropagation();
          e.preventDefault();
          return;
        }
        markClean();
      }
      suppressDirtyUntil = Date.now() + 2800;
      return;
    }

    if (isAnyLoadTrigger(btn)) {
      suppressDirtyUntil = Date.now() + 2800;
      return;
    }

    const { localBtn, serverBtn } = findStudioButtons();

    // 사용자가 '저장' 버튼을 누르면 -> 로컬 저장 실행 직후 '서버 저장'까지 자동 실행!
    if (localBtn && btn === localBtn) {
      triggerUnifiedSave(true);
      return;
    }

    // 사용자가 직접 '서버 저장' 버튼을 누른 경우 -> 로컬 저장도 먼저 실행 후 서버 저장 완료 추적
    if (serverBtn && btn === serverBtn) {
      if (localBtn) {
        isAutoChaining = true;
        try { localBtn.click(); } catch (err) {}
        isAutoChaining = false;
      }
      if (!navigator.onLine) {
        showToast('⚠️ 오프라인 상태입니다. 인터넷 연결 후 다시 서버 저장을 눌러주세요.', 3000);
        return;
      }
      beginServerSaveWatch();
      return;
    }

    // 치환·쾌속카드·허용어 반영 버튼 클릭 시 미저장 상태로 표시
    const actionLabel = cleanLabel(btn);
    if (
      /치환|일괄\s*적용|수정\s*적용|수정\s*완료|허용어\s*추가|단어\s*추가|문장\s*적용/.test(actionLabel) &&
      !/취소|닫기/.test(actionLabel)
    ) {
      setTimeout(() => markDirty('action:' + actionLabel), 120);
    }
  }, true);

  // 키보드 Ctrl+S / Cmd+S 통합 저장 단축키
  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      triggerUnifiedSave(false);
    }
  });

  /* =========================================================
     6. 원고 편집 및 뷰어 텍스트 변경 감지
     ========================================================= */
  function isIgnoredInput(el) {
    if (!el) return true;
    if (el.classList && el.classList.contains('v98-search-input')) return true;
    const type = (el.type || '').toLowerCase();
    if (['search', 'range', 'file', 'checkbox', 'radio', 'color'].includes(type)) return true;
    const meta = ((el.id || '') + ' ' + (el.placeholder || '') + ' ' + (el.className || '')).toLowerCase();
    if (/search|검색|apikey|api_key|api-key|rate|pitch|speed|배속/.test(meta)) return true;
    return false;
  }

  document.addEventListener('input', function (e) {
    const t = e.target;
    if (!t) return;
    if (t.tagName === 'TEXTAREA' || t.isContentEditable || (t.tagName === 'INPUT' && !isIgnoredInput(t))) {
      markDirty('input');
    }
  }, true);

  document.addEventListener('change', function (e) {
    const t = e.target;
    if (t && t.type === 'file') {
      suppressDirtyUntil = Date.now() + 3000;
    }
  }, true);

  function captureViewerDigest() {
    const root =
      document.getElementById('highlightViewer') ||
      document.getElementById('novelViewer') ||
      document.querySelector('.highlight-viewer');
    if (!root) return '';
    const txt = (root.textContent || '').trim();
    return txt.length + ':' + txt.slice(0, 120) + ':' + txt.slice(-120);
  }

  function attachViewerObserver() {
    const root =
      document.getElementById('highlightViewer') ||
      document.getElementById('novelViewer') ||
      document.querySelector('.highlight-viewer');
    if (!root) return;

    viewerSnapshot = captureViewerDigest();
    let debounceTimer = null;

    const obs = new MutationObserver((mutations) => {
      const hasContentMutation = mutations.some(
        m => m.type === 'characterData' || m.type === 'childList'
      );
      if (!hasContentMutation) return;

      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const nextDigest = captureViewerDigest();
        if (!viewerSnapshot) {
          viewerSnapshot = nextDigest;
          return;
        }
        if (nextDigest !== viewerSnapshot) {
          viewerSnapshot = nextDigest;
          if (Date.now() >= suppressDirtyUntil) {
            markDirty('viewer-mutation');
          }
        }
      }, 280);
    });

    obs.observe(root, { characterData: true, childList: true, subtree: true });
  }

  /* =========================================================
     7. 닫기 전 경고 (PC 브라우저 창 닫기 + 모바일/APK 뒤로가기 모달)
     ========================================================= */
  window.addEventListener('beforeunload', function (e) {
    if (!isDirty) return;
    e.preventDefault();
    e.returnValue = '아직 서버 저장이 완료되지 않은 작업 내역이 있습니다.';
    return e.returnValue;
  });

  function initUIAndGuards() {
    // 우측 상단 통합 저장 상태 배지
    pillEl = document.createElement('button');
    pillEl.type = 'button';
    pillEl.className = 'v99-save-pill';
    pillEl.title = '누르면 기기 저장과 서버 저장을 한 번에 실행합니다 (Ctrl+S)';
    pillEl.textContent = '☁️ 저장됨';
    pillEl.addEventListener('click', () => triggerUnifiedSave(false));
    document.body.appendChild(pillEl);

    // 모바일/웹뷰 APK 뒤로가기 종료 방지 모달
    const modalBackdrop = document.createElement('div');
    modalBackdrop.className = 'v99-modal-backdrop';
    modalBackdrop.innerHTML = `
      <div class="v99-modal" role="dialog" aria-modal="true">
        <h3>⚠️ 아직 서버에 저장되지 않았습니다</h3>
        <p>수정한 원고나 설정이 아직 서버에 반영되지 않았습니다. 지금 통합 저장(기기+서버) 후 이동하시겠습니까?</p>
        <div class="v99-modal-btns">
          <button type="button" class="v99-mbtn-save" data-act="save">💾 지금 통합 저장하기</button>
          <button type="button" class="v99-mbtn-stay" data-act="stay">계속 작업하기</button>
          <button type="button" class="v99-mbtn-exit" data-act="exit">저장 안 하고 나가기</button>
        </div>
      </div>
    `;
    document.body.appendChild(modalBackdrop);

    modalBackdrop.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const act = btn.dataset.act;
      modalBackdrop.classList.remove('open');
      if (act === 'save') {
        triggerUnifiedSave(false);
      } else if (act === 'exit') {
        markClean();
        historyGuardArmed = false;
        bypassPopstateOnce = true;
        history.back();
      }
    });

    window.addEventListener('popstate', () => {
      if (bypassPopstateOnce) {
        bypassPopstateOnce = false;
        return;
      }
      if (isDirty) {
        historyGuardArmed = false;
        armHistoryGuard();
        modalBackdrop.classList.add('open');
      }
    });

    // 이전 세션에서 서버 저장 없이 강제 종료된 기록이 있을 때 상단 복구 경고 배너 표시
    try {
      const prevGuard = localStorage.getItem(STORAGE_GUARD_KEY);
      if (prevGuard) {
        const banner = document.createElement('div');
        banner.id = 'v99-recovery-banner';
        banner.className = 'v99-banner';
        banner.innerHTML = `
          <span>⚠️ <b>미저장 종료 감지:</b> 지난 작업 후 '서버 저장'을 누르지 않고 닫은 기록이 있습니다. 서버 불러오기를 먼저 누르면 예전 파일로 덮어써질 수 있으니 먼저 통합 저장을 실행해 주세요.</span>
          <div class="v99-banner-actions">
            <button type="button" class="v99-btn primary" data-bact="save">💾 지금 통합 저장</button>
            <button type="button" class="v99-btn ghost" data-bact="dismiss">확인(무시)</button>
          </div>
        `;
        document.body.appendChild(banner);
        banner.addEventListener('click', (e) => {
          const b = e.target.closest('[data-bact]');
          if (!b) return;
          if (b.dataset.bact === 'save') {
            triggerUnifiedSave(false);
          } else {
            localStorage.removeItem(STORAGE_GUARD_KEY);
            banner.remove();
          }
        });
      }
    } catch (e) {}

    setTimeout(attachViewerObserver, 1200);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initUIAndGuards);
  } else {
    initUIAndGuards();
  }
})();
