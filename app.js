(function () {
  "use strict";

  const PREV_STATS_KEY = "koru_prev_stats_v1";
  const SHARED_CACHE = "koru-shared-pdf";
  const IDB_NAME = "koru_liste_idb_v1";
  const IDB_STORE = "guides";
  const IDB_KEY = "latest";
  const PW = 595.2;
  const PH = 841.68;

  const offlineBadge = document.getElementById("offlineBadge");
  const installBanner = document.getElementById("installBanner");
  const installBtn = document.getElementById("installBtn");
  const errorBox = document.getElementById("errorBox");
  const uploadSection = document.getElementById("uploadSection");
  const progressSection = document.getElementById("progressSection");
  const resultSection = document.getElementById("resultSection");
  const fileInput = document.getElementById("fileInput");
  const fileNameLabel = document.getElementById("fileNameLabel");
  const progressBar = document.getElementById("progressBar");
  const progressMsg = document.getElementById("progressMsg");

  const dateBadgeEl = document.getElementById("dateBadge");
  const statFirmsEl = document.getElementById("statFirms");
  const statBlokEl = document.getElementById("statBlok");
  const statOturumEl = document.getElementById("statOturum");
  const statPlatesEl = document.getElementById("statPlates");
  const diffBoxEl = document.getElementById("diffBox");
  const firmsMetaEl = document.getElementById("firmsMeta");
  const blokMetaEl = document.getElementById("blokMeta");

  const openFirmsViewerBtn = document.getElementById("openFirmsViewerBtn");
  const openBlokViewerBtn = document.getElementById("openBlokViewerBtn");
  const dlFirmsBtn = document.getElementById("dlFirmsBtn");
  const shareFirmsBtn = document.getElementById("shareFirmsBtn");
  const dlBlokBtn = document.getElementById("dlBlokBtn");
  const shareBlokBtn = document.getElementById("shareBlokBtn");
  const resetBtn = document.getElementById("resetBtn");

  // Built-in Viewer Elements
  const viewerModal = document.getElementById("viewerModal");
  const viewerHomeBtn = document.getElementById("viewerHomeBtn");
  const viewerPrevBtn = document.getElementById("viewerPrevBtn");
  const viewerNextBtn = document.getElementById("viewerNextBtn");
  const viewerPageSelect = document.getElementById("viewerPageSelect");
  const viewerCloseBtn = document.getElementById("viewerCloseBtn");
  const viewerSearchInput = document.getElementById("viewerSearchInput");
  const viewerSearchClear = document.getElementById("viewerSearchClear");
  const viewerHitsBar = document.getElementById("viewerHitsBar");
  const viewerBody = document.getElementById("viewerBody");
  const pageStage = document.getElementById("pageStage");
  const viewerCanvas = document.getElementById("viewerCanvas");
  const viewerHotspots = document.getElementById("viewerHotspots");

  if (window.pdfjsLib) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = "./vendor/pdf.worker.min.js";
  }

  let deferredPrompt = null;
  let cachedFonts = null;
  let activeUrls = [];
  let currentOutputs = null;

  // Active Viewer State
  let viewerPdfDoc = null;
  let viewerPageMeta = [];
  let viewerCurPage = 1;
  let viewerTotalPages = 1;
  let viewerRenderTask = null;

  // Service Worker registration + auto-reload when a new version activates
  if ("serviceWorker" in navigator) {
    let swRefreshing = false;
    const hadController = Boolean(navigator.serviceWorker.controller);
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (hadController && !swRefreshing) {
        swRefreshing = true;
        window.location.reload();
      }
    });
    window.addEventListener("load", () => {
      navigator.serviceWorker
        .register("./sw.js")
        .then((reg) => {
          try { reg.update(); } catch (_) {}
          if (reg.active || navigator.serviceWorker.controller) {
            offlineBadge.style.display = "inline-block";
          }
          navigator.serviceWorker.ready.then(() => {
            offlineBadge.style.display = "inline-block";
          });
        })
        .catch((err) => console.warn("SW kayıt hatası:", err));
    });
  }

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    installBanner.style.display = "flex";
  });

  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    installBanner.style.display = "none";
  });

  installBtn.addEventListener("click", async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    try { await deferredPrompt.userChoice; } catch (_) {}
    deferredPrompt = null;
    installBanner.style.display = "none";
  });

  function showError(msg) {
    errorBox.textContent = msg;
    errorBox.classList.remove("hidden");
  }

  function clearError() {
    errorBox.textContent = "";
    errorBox.classList.add("hidden");
  }

  function revokeActiveUrls() {
    for (const u of activeUrls) {
      try { URL.revokeObjectURL(u); } catch (_) {}
    }
    activeUrls = [];
  }

  // ---------------- INDEXEDDB PERSISTENCE ----------------
  function openIdb() {
    return new Promise((resolve, reject) => {
      if (!("indexedDB" in window)) return reject(new Error("No IndexedDB"));
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function saveGuideToIdb(payload) {
    try {
      const db = await openIdb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, "readwrite");
        tx.objectStore(IDB_STORE).put(payload, IDB_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    } catch (e) {
      console.warn("IndexedDB kayıt uyarısı:", e);
    }
  }

  async function loadGuideFromIdb() {
    try {
      const db = await openIdb();
      const data = await new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, "readonly");
        const req = tx.objectStore(IDB_STORE).get(IDB_KEY);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
      db.close();
      return data;
    } catch (_) {
      return null;
    }
  }

  async function loadFonts() {
    if (cachedFonts) return cachedFonts;
    const [regResp, boldResp] = await Promise.all([
      fetch("./fonts/Roboto-Regular.ttf"),
      fetch("./fonts/Roboto-Bold.ttf"),
    ]);
    if (!regResp.ok || !boldResp.ok) {
      throw new Error("Yazı tipleri (Roboto) yüklenemedi.");
    }
    const [fontRegularBytes, fontBoldBytes] = await Promise.all([
      regResp.arrayBuffer(),
      boldResp.arrayBuffer(),
    ]);
    cachedFonts = { fontRegularBytes, fontBoldBytes };
    return cachedFonts;
  }

  function computeLocalDiff(newStats) {
    try {
      const rawPrev = localStorage.getItem(PREV_STATS_KEY);
      if (!rawPrev) return null;
      const prev = JSON.parse(rawPrev);
      const items = [];

      if (Array.isArray(prev.employeeNames) && Array.isArray(newStats.employeeNames)) {
        const oldSet = new Set(prev.employeeNames);
        const newSet = new Set(newStats.employeeNames);
        const added = newStats.employeeNames.filter((x) => !oldSet.has(x));
        const removed = prev.employeeNames.filter((x) => !newSet.has(x));
        if (added.length || removed.length) {
          items.push(`Firmalar: +${added.length} eklenen, -${removed.length} çıkarılan çalışan`);
        } else {
          items.push("Firmalar: Değişiklik yok");
        }
      }

      if (typeof prev.blokNotifCount === "number") {
        const deltaN = newStats.blokNotifCount - prev.blokNotifCount;
        const deltaG = newStats.blokGroupCount - (prev.blokGroupCount || 0);
        const signN = deltaN > 0 ? `+${deltaN}` : `${deltaN}`;
        const signG = deltaG > 0 ? `+${deltaG}` : `${deltaG}`;
        items.push(
          `Blok 1–7 & 16 Bildirimleri: ${newStats.blokNotifCount} aktif (${signN}), ${newStats.blokGroupCount} daire/grup (${signG})`
        );
      }

      if (!items.length) return null;
      return { prevDate: prev.dateBadge || "Önceki Liste", items };
    } catch (_) {
      return null;
    }
  }

  function saveLocalStats(stats) {
    try {
      localStorage.setItem(PREV_STATS_KEY, JSON.stringify({
        dateBadge: stats.dateBadge,
        employeeCount: stats.employeeCount,
        blokGroupCount: stats.blokGroupCount,
        blokNotifCount: stats.blokNotifCount,
        employeeNames: stats.employeeNames,
      }));
    } catch (_) {}
  }

  function formatKb(bytesLen) {
    if (bytesLen >= 1024 * 1024) {
      return `${(bytesLen / (1024 * 1024)).toFixed(2)} MB`;
    }
    return `${Math.round(bytesLen / 1024)} KB`;
  }

  function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    activeUrls.push(url);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function triggerOpenOrShare(blob, filename, title) {
    const file = new File([blob], filename, { type: "application/pdf" });
    if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ title, files: [file] });
        return;
      } catch (err) {
        if (err && err.name === "AbortError") return;
      }
    }
    triggerDownload(blob, filename);
  }

  function populateResultsUI(res, diff) {
    const firmsBytes = res.firmsPdfBytes instanceof Uint8Array
      ? res.firmsPdfBytes
      : new Uint8Array(res.firmsPdfBytes);
    const blokBytes = res.blokPdfBytes instanceof Uint8Array
      ? res.blokPdfBytes
      : new Uint8Array(res.blokPdfBytes);

    const firmsBlob = new Blob([firmsBytes], { type: "application/pdf" });
    const blokBlob = new Blob([blokBytes], { type: "application/pdf" });

    currentOutputs = {
      firmsBytes,
      blokBytes,
      firmsBlob,
      blokBlob,
      firmsFilename: res.firmsFilename,
      blokFilename: res.blokFilename,
      firmsPageMeta: res.firmsPageMeta || [],
      blokPageMeta: res.blokPageMeta || [],
      stats: res.stats,
    };

    const st = res.stats;
    dateBadgeEl.textContent = `Liste Tarihi: ${st.dateBadge}`;
    statFirmsEl.textContent = `${st.employeeCount} Kişi / ${st.firmCount} Firma`;
    statBlokEl.textContent = `${st.blokGroupCount} Grup / ${st.blokNotifCount} Kayıt`;
    statOturumEl.textContent = `${st.oturumFiltered} Daire`;
    statPlatesEl.textContent = `${st.plateCount} Plaka`;

    firmsMetaEl.textContent = `${res.firmsFilename} • ${formatKb(firmsBytes.byteLength)}`;
    blokMetaEl.textContent = `${res.blokFilename} • ${formatKb(blokBytes.byteLength)}`;

    if (diff) {
      diffBoxEl.innerHTML =
        `<div>📊 Önceki yüklemeye göre (${diff.prevDate}) değişimler:</div>` +
        `<ul>${diff.items.map((x) => `<li>${x}</li>`).join("")}</ul>`;
      diffBoxEl.classList.remove("hidden");
    } else {
      diffBoxEl.classList.add("hidden");
    }

    uploadSection.classList.add("hidden");
    progressSection.classList.add("hidden");
    resultSection.classList.remove("hidden");
  }

  async function processArrayBuffer(arrayBuffer, filename) {
    clearError();
    revokeActiveUrls();
    currentOutputs = null;

    uploadSection.classList.add("hidden");
    resultSection.classList.add("hidden");
    progressSection.classList.remove("hidden");
    fileNameLabel.textContent = `Seçilen dosya: ${filename}`;
    progressBar.style.width = "3%";
    progressMsg.textContent = "Yazı tipleri hazırlanıyor...";

    try {
      const { fontRegularBytes, fontBoldBytes } = await loadFonts();
      const res = await window.KoruConverter.convertSchedulePdf(
        arrayBuffer,
        {
          pdfjsLib: window.pdfjsLib,
          PDFLib: window.PDFLib,
          fontkit: window.fontkit,
          fontRegularBytes,
          fontBoldBytes,
        },
        (pct, msg) => {
          progressBar.style.width = `${pct}%`;
          progressMsg.textContent = msg;
        },
        filename
      );

      const diff = computeLocalDiff(res.stats);
      saveLocalStats(res.stats);
      await saveGuideToIdb({
        firmsPdfBytes: res.firmsPdfBytes,
        blokPdfBytes: res.blokPdfBytes,
        firmsPageMeta: res.firmsPageMeta,
        blokPageMeta: res.blokPageMeta,
        firmsFilename: res.firmsFilename,
        blokFilename: res.blokFilename,
        stats: res.stats,
      });

      populateResultsUI(res, diff);
    } catch (err) {
      console.error("Dönüştürme hatası:", err);
      progressSection.classList.add("hidden");
      uploadSection.classList.remove("hidden");
      showError(
        err && err.message
          ? `PDF işlenemedi: ${err.message}`
          : "Seçilen dosya geçerli bir Koru Sitesi Personel Giriş Çıkış Çizelgesi PDF'i değil."
      );
    } finally {
      fileInput.value = "";
    }
  }

  // ---------------- BUILT-IN INTERACTIVE TOUCH PDF VIEWER ----------------

  async function openInteractiveViewer(which) {
    if (!currentOutputs) return;
    const isBlok = which === "blok";
    const pdfBytes = isBlok ? currentOutputs.blokBytes : currentOutputs.firmsBytes;
    viewerPageMeta = isBlok ? currentOutputs.blokPageMeta : currentOutputs.firmsPageMeta;

    if (viewerPdfDoc) {
      try { await viewerPdfDoc.destroy(); } catch (_) {}
      viewerPdfDoc = null;
    }

    const copyBytes = new Uint8Array(pdfBytes.byteLength);
    copyBytes.set(pdfBytes);

    viewerPdfDoc = await window.pdfjsLib.getDocument({
      data: copyBytes,
      verbosity: 0,
      useWorkerFetch: false,
    }).promise;

    viewerTotalPages = viewerPdfDoc.numPages;
    viewerPageSelect.innerHTML = "";
    for (let i = 1; i <= viewerTotalPages; i++) {
      const opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = `Sayfa ${i} / ${viewerTotalPages}`;
      viewerPageSelect.appendChild(opt);
    }

    viewerSearchInput.value = "";
    viewerSearchClear.style.display = "none";
    viewerHitsBar.innerHTML = "";
    viewerHitsBar.classList.add("hidden");

    viewerModal.classList.remove("hidden");
    document.body.style.overflow = "hidden";
    await renderViewerPage(1, null);
  }

  async function closeInteractiveViewer() {
    viewerModal.classList.add("hidden");
    document.body.style.overflow = "";
    if (viewerRenderTask) {
      try { viewerRenderTask.cancel(); } catch (_) {}
      viewerRenderTask = null;
    }
    if (viewerPdfDoc) {
      try { await viewerPdfDoc.destroy(); } catch (_) {}
      viewerPdfDoc = null;
    }
  }

  async function renderViewerPage(pageNum, targetY_TD) {
    if (!viewerPdfDoc) return;
    const pNum = Math.max(1, Math.min(viewerTotalPages, pageNum));
    viewerCurPage = pNum;
    viewerPageSelect.value = String(pNum);
    viewerPrevBtn.disabled = pNum <= 1;
    viewerNextBtn.disabled = pNum >= viewerTotalPages;

    // Highlight active search chip if present
    viewerHitsBar.querySelectorAll(".hit-chip").forEach((btn) => {
      btn.classList.toggle("active", Number(btn.dataset.page) === pNum);
    });

    if (viewerRenderTask) {
      try { viewerRenderTask.cancel(); } catch (_) {}
      viewerRenderTask = null;
    }

    const page = await viewerPdfDoc.getPage(pNum);
    const dpr = Math.min(2.25, Math.max(1.5, window.devicePixelRatio || 1.5));
    const stageWidth = Math.min(595, Math.max(320, (viewerBody.clientWidth || 380) - 12));
    const cssScale = stageWidth / PW;
    const renderViewport = page.getViewport({ scale: cssScale * dpr });

    viewerCanvas.width = Math.floor(renderViewport.width);
    viewerCanvas.height = Math.floor(renderViewport.height);
    viewerCanvas.style.width = `${Math.floor(PW * cssScale)}px`;
    viewerCanvas.style.height = `${Math.floor(PH * cssScale)}px`;
    pageStage.style.width = `${Math.floor(PW * cssScale)}px`;
    pageStage.style.height = `${Math.floor(PH * cssScale)}px`;

    const ctx = viewerCanvas.getContext("2d", { alpha: false });
    viewerRenderTask = page.render({ canvasContext: ctx, viewport: renderViewport });
    try {
      await viewerRenderTask.promise;
    } catch (e) {
      if (e && e.name === "RenderingCancelledException") return;
    }

    // Build clickable touch hotspots on this page
    viewerHotspots.innerHTML = "";
    const meta = viewerPageMeta[pNum - 1];
    const links = (meta && meta.links) || [];
    for (const lnk of links) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "pdf-hotspot";
      btn.style.left = `${((lnk.x0 / PW) * 100).toFixed(2)}%`;
      btn.style.top = `${((lnk.y0 / PH) * 100).toFixed(2)}%`;
      btn.style.width = `${(((lnk.x1 - lnk.x0) / PW) * 100).toFixed(2)}%`;
      btn.style.height = `${(((lnk.y1 - lnk.y0) / PH) * 100).toFixed(2)}%`;
      btn.dataset.targetPage = String(lnk.targetPage);
      btn.dataset.targetY = String(lnk.targetY || 0);
      btn.setAttribute("aria-label", `Sayfa ${lnk.targetPage}'e git`);
      btn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        renderViewerPage(lnk.targetPage, lnk.targetY);
      });
      viewerHotspots.appendChild(btn);
    }

    // Scroll to targetY_TD if jumped via link, otherwise top of page
    if (typeof targetY_TD === "number" && targetY_TD > 35) {
      const yPx = Math.max(0, (targetY_TD / PH) * (PH * cssScale) - 18);
      viewerBody.scrollTo({ top: yPx, behavior: "smooth" });

      const flash = document.createElement("div");
      flash.className = "jump-flash";
      flash.style.top = `${Math.max(0, ((targetY_TD + 4) / PH) * 100).toFixed(2)}%`;
      viewerHotspots.appendChild(flash);
      setTimeout(() => { try { flash.remove(); } catch (_) {} }, 1450);
    } else {
      viewerBody.scrollTo({ top: 0, behavior: "auto" });
    }
  }

  function runViewerSearch() {
    const raw = viewerSearchInput.value.trim();
    viewerSearchClear.style.display = raw ? "block" : "none";
    if (raw.length < 2 || !viewerPageMeta.length) {
      viewerHitsBar.innerHTML = "";
      viewerHitsBar.classList.add("hidden");
      return;
    }

    const qNorm = window.KoruConverter.toAsciiLower(raw);
    const tokens = qNorm.split(/\s+/).filter(Boolean);
    const qCompact = qNorm.replace(/[\s/.-]+/g, "");

    const hitPages = [];
    for (let i = 0; i < viewerPageMeta.length; i++) {
      const st = (viewerPageMeta[i] && viewerPageMeta[i].searchText) || "";
      if (!st) continue;
      const stCompact = st.replace(/[\s/.-]+/g, "");
      const ok =
        (qCompact.length >= 2 && stCompact.includes(qCompact)) ||
        tokens.every((t) => st.includes(t) || stCompact.includes(t.replace(/[\s/.-]+/g, "")));
      if (ok) hitPages.push(i + 1);
    }

    viewerHitsBar.innerHTML = "";
    if (!hitPages.length) {
      const emptyEl = document.createElement("span");
      emptyEl.style.fontSize = "13px";
      emptyEl.style.color = "#fca5a5";
      emptyEl.style.fontWeight = "700";
      emptyEl.textContent = "Eşleşen sayfa bulunamadı.";
      viewerHitsBar.appendChild(emptyEl);
      viewerHitsBar.classList.remove("hidden");
      return;
    }

    const lbl = document.createElement("span");
    lbl.style.fontSize = "12.5px";
    lbl.style.color = "#cbd5e1";
    lbl.style.fontWeight = "700";
    lbl.style.flexShrink = "0";
    lbl.textContent = `Bulunan (${hitPages.length}):`;
    viewerHitsBar.appendChild(lbl);

    for (const pNum of hitPages) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "hit-chip" + (pNum === viewerCurPage ? " active" : "");
      chip.dataset.page = String(pNum);
      chip.textContent = pNum === 1 ? "S.1 (Fihrist)" : `Sayfa ${pNum}`;
      chip.addEventListener("click", () => renderViewerPage(pNum, null));
      viewerHitsBar.appendChild(chip);
    }
    viewerHitsBar.classList.remove("hidden");

    // Automatically jump to the best detail page hit (prefer non-index page if available)
    const firstDetailPage = hitPages.find((p) => p > 1) || hitPages[0];
    if (!hitPages.includes(viewerCurPage)) {
      renderViewerPage(firstDetailPage, null);
    }
  }

  openFirmsViewerBtn.addEventListener("click", () => openInteractiveViewer("firms"));
  openBlokViewerBtn.addEventListener("click", () => openInteractiveViewer("blok"));
  viewerHomeBtn.addEventListener("click", () => renderViewerPage(1, null));
  viewerPrevBtn.addEventListener("click", () => renderViewerPage(viewerCurPage - 1, null));
  viewerNextBtn.addEventListener("click", () => renderViewerPage(viewerCurPage + 1, null));
  viewerPageSelect.addEventListener("change", () => renderViewerPage(Number(viewerPageSelect.value), null));
  viewerCloseBtn.addEventListener("click", () => closeInteractiveViewer());
  viewerSearchInput.addEventListener("input", () => runViewerSearch());
  viewerSearchClear.addEventListener("click", () => {
    viewerSearchInput.value = "";
    runViewerSearch();
    viewerSearchInput.focus();
  });

  // ---------------- FILE INPUT & ACTIONS ----------------

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    const ab = await file.arrayBuffer();
    await processArrayBuffer(ab, file.name);
  });

  uploadSection.addEventListener("dragover", (e) => {
    e.preventDefault();
    uploadSection.classList.add("dragover");
  });
  uploadSection.addEventListener("dragleave", () => uploadSection.classList.remove("dragover"));
  uploadSection.addEventListener("drop", async (e) => {
    e.preventDefault();
    uploadSection.classList.remove("dragover");
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!file) return;
    const ab = await file.arrayBuffer();
    await processArrayBuffer(ab, file.name);
  });

  dlFirmsBtn.addEventListener("click", () => {
    if (currentOutputs) triggerDownload(currentOutputs.firmsBlob, currentOutputs.firmsFilename);
  });
  shareFirmsBtn.addEventListener("click", () => {
    if (currentOutputs) triggerOpenOrShare(currentOutputs.firmsBlob, currentOutputs.firmsFilename, "Firmalar ve Çalışanlar PDF");
  });
  dlBlokBtn.addEventListener("click", () => {
    if (currentOutputs) triggerDownload(currentOutputs.blokBlob, currentOutputs.blokFilename);
  });
  shareBlokBtn.addEventListener("click", () => {
    if (currentOutputs) triggerOpenOrShare(currentOutputs.blokBlob, currentOutputs.blokFilename, "Blok 1-7 & 16 Mobil Rehber");
  });

  resetBtn.addEventListener("click", () => {
    clearError();
    resultSection.classList.add("hidden");
    uploadSection.classList.remove("hidden");
    fileInput.click();
  });

  async function initStartup() {
    const params = new URLSearchParams(window.location.search);
    if (params.get("share_err") === "1") {
      showError("Paylaşılan PDF okunamadı. Lütfen 'Yeni PDF Seç' butonu ile tekrar seçin.");
      window.history.replaceState({}, "", "./");
      return;
    }
    if (params.get("shared") === "1" && "caches" in window) {
      try {
        const sc = await caches.open(SHARED_CACHE);
        const keyUrl = new URL("./__shared_pdf__", window.location.href).href;
        const resp = await sc.match(keyUrl);
        if (resp) {
          const fname = decodeURIComponent(resp.headers.get("X-Filename") || "Paylasilan_Liste.pdf");
          const ab = await resp.arrayBuffer();
          await sc.delete(keyUrl);
          window.history.replaceState({}, "", "./");
          await processArrayBuffer(ab, fname);
          return;
        }
      } catch (err) {
        console.error("Paylaşılan dosya yüklenemedi:", err);
      }
    }

    // Restore previously converted guides from IndexedDB so father can open immediately!
    const saved = await loadGuideFromIdb();
    if (saved && saved.firmsPdfBytes && saved.blokPdfBytes && saved.stats) {
      populateResultsUI(saved, null);
    }
  }

  initStartup();
})();
