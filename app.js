(function () {
  "use strict";

  const PREV_STATS_KEY = "koru_prev_stats_v1";
  const SHARED_CACHE = "koru-shared-pdf";

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

  const dlFirmsBtn = document.getElementById("dlFirmsBtn");
  const shareFirmsBtn = document.getElementById("shareFirmsBtn");
  const dlBlokBtn = document.getElementById("dlBlokBtn");
  const shareBlokBtn = document.getElementById("shareBlokBtn");
  const resetBtn = document.getElementById("resetBtn");

  if (window.pdfjsLib) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = "./vendor/pdf.worker.min.js";
  }

  let deferredPrompt = null;
  let cachedFonts = null;
  let activeUrls = [];
  let currentOutputs = null;

  // Service Worker registration for offline + Android Web Share Target
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker
        .register("./sw.js")
        .then((reg) => {
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
      if (!rawPrev) {
        return null;
      }
      const prev = JSON.parse(rawPrev);
      const items = [];

      if (Array.isArray(prev.employeeNames) && Array.isArray(newStats.employeeNames)) {
        const oldSet = new Set(prev.employeeNames);
        const newSet = new Set(newStats.employeeNames);
        const added = newStats.employeeNames.filter((x) => !oldSet.has(x));
        const removed = prev.employeeNames.filter((x) => !newSet.has(x));
        if (added.length || removed.length) {
          items.push(
            `Firmalar: +${added.length} eklenen, -${removed.length} çıkarılan çalışan`
          );
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
    const url = URL.createObjectURL(blob);
    activeUrls.push(url);
    window.open(url, "_blank", "noopener") || triggerDownload(blob, filename);
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

      const firmsBlob = new Blob([res.firmsPdfBytes], { type: "application/pdf" });
      const blokBlob = new Blob([res.blokPdfBytes], { type: "application/pdf" });
      currentOutputs = {
        firmsBlob,
        blokBlob,
        firmsFilename: res.firmsFilename,
        blokFilename: res.blokFilename,
      };

      const st = res.stats;
      dateBadgeEl.textContent = `Liste Tarihi: ${st.dateBadge}`;
      statFirmsEl.textContent = `${st.employeeCount} Kişi / ${st.firmCount} Firma`;
      statBlokEl.textContent = `${st.blokGroupCount} Grup / ${st.blokNotifCount} Kayıt`;
      statOturumEl.textContent = `${st.oturumFiltered} Daire`;
      statPlatesEl.textContent = `${st.plateCount} Plaka`;

      firmsMetaEl.textContent = `${res.firmsFilename} • ${formatKb(res.firmsPdfBytes.byteLength)}`;
      blokMetaEl.textContent = `${res.blokFilename} • ${formatKb(res.blokPdfBytes.byteLength)}`;

      const diff = computeLocalDiff(st);
      if (diff) {
        diffBoxEl.innerHTML =
          `<div>📊 Önceki yüklemeye göre (${diff.prevDate}) değişimler:</div>` +
          `<ul>${diff.items.map((x) => `<li>${x}</li>`).join("")}</ul>`;
        diffBoxEl.classList.remove("hidden");
      } else {
        diffBoxEl.classList.add("hidden");
      }
      saveLocalStats(st);

      progressSection.classList.add("hidden");
      resultSection.classList.remove("hidden");
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

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    const ab = await file.arrayBuffer();
    await processArrayBuffer(ab, file.name);
  });

  // Desktop drag-and-drop convenience
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
    revokeActiveUrls();
    currentOutputs = null;
    resultSection.classList.add("hidden");
    uploadSection.classList.remove("hidden");
  });

  // Handle PDF shared directly from WhatsApp via Android Web Share Target
  async function checkSharedPdfOnStartup() {
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
        }
      } catch (err) {
        console.error("Paylaşılan dosya yüklenemedi:", err);
      }
    }
  }

  checkSharedPdfOnStartup();
})();
