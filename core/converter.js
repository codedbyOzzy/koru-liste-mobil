(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.KoruConverter = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const PW = 595.2;
  const PH = 841.68;
  const GRAY_RGB = [0.749, 0.749, 0.749];

  const TARGET_BLOCKS = new Set([1, 2, 3, 4, 5, 6, 7, 16]);
  const ALLOWED_MULTI_LABELS = new Set([
    "B7/D3 & B9/D3 (Çoklu)",
    "B6/D12 - B14/D1 - B15/D2 (Çoklu)",
    "B7/D13 & B16/D11 (Çoklu)",
    "Genel / Blok Belirtilmemiş",
  ]);

  const BAD_PLATE_WORDS = new Set([
    "AD", "ADET", "AY", "BLOK", "D", "DA", "DAIRE", "DAİRE", "GUN", "GÜN",
    "KAT", "KISI", "KİŞİ", "NOLU", "NO", "SAAT", "SAN", "TC", "TEL", "TLF",
    "VB", "VE", "YIL",
  ]);

  const AKSOY_NEW_NAMES = new Set([
    "Abdulselam Akyol",
    "Dilhan Akyol",
    "Nesim Akyol",
    "Mustafa Akyol",
  ]);

  const TR_CHAR_MAP = {
    "İ": "I", "I": "I", "ı": "i",
    "Ş": "S", "ş": "s",
    "Ğ": "G", "ğ": "g",
    "Ü": "U", "ü": "u",
    "Ö": "O", "ö": "o",
    "Ç": "C", "ç": "c",
    "Â": "A", "â": "a",
    "Î": "I", "î": "i",
    "Û": "U", "û": "u",
  };

  function toAsciiLower(text) {
    if (!text) return "";
    let out = "";
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      out += TR_CHAR_MAP[ch] || ch;
    }
    return out
      .toLowerCase()
      .replace(/[\u2010\u2013\u2014]/g, "-")
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function toPrintableAscii(text) {
    if (!text) return "";
    let s = "";
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      const ch = text[i];
      if (TR_CHAR_MAP[ch]) {
        s += TR_CHAR_MAP[ch];
      } else if ((code >= 32 && code <= 126) || code === 10) {
        s += ch;
      } else {
        s += " ";
      }
    }
    return s.replace(/[ \t]+/g, " ").trim();
  }

  const TR_ORDER = "0123456789abcçdefgğhıijklmnoöprsştuüvyzqwx";
  function compareTr(a, b) {
    const sa = (a || "").replace(/İ/g, "i").replace(/I/g, "ı").toLowerCase().trim();
    const sb = (b || "").replace(/İ/g, "i").replace(/I/g, "ı").toLowerCase().trim();
    const len = Math.min(sa.length, sb.length);
    for (let i = 0; i < len; i++) {
      const ca = sa[i];
      const cb = sb[i];
      if (ca === cb) continue;
      const ia = TR_ORDER.indexOf(ca);
      const ib = TR_ORDER.indexOf(cb);
      const wa = ia >= 0 ? ia : 100 + sa.charCodeAt(i);
      const wb = ib >= 0 ? ib : 100 + sb.charCodeAt(i);
      if (wa !== wb) return wa - wb;
    }
    return sa.length - sb.length;
  }

  function truncText(txt, maxLen) {
    const s = (txt || "").trim();
    if (s.length <= maxLen) return s;
    return s.slice(0, Math.max(1, maxLen - 1)).trimEnd() + "…";
  }

  function extractPlates(text) {
    const found = [];
    const seen = new Set();
    const norm = (text || "").replace(/\s+/g, " ");
    const plateRe = /(\*?\d{1,2})\s*([A-ZÇĞİÖŞÜa-zçğıöşü]{1,3})\s*(\d{2,5})/g;
    let m;
    while ((m = plateRe.exec(norm)) !== null) {
      const idxBefore = m.index - 1;
      const idxAfter = m.index + m[0].length;
      if (idxBefore >= 0 && /[0-9A-Za-zÇĞİÖŞÜçğıöşü]/.test(norm[idxBefore])) continue;
      if (idxAfter < norm.length && /[0-9A-Za-zÇĞİÖŞÜçğıöşü]/.test(norm[idxAfter])) continue;

      const p1 = m[1];
      const p2Raw = m[2];
      const p3 = m[3];
      const p2Up = p2Raw.replace(/i/g, "İ").toUpperCase();
      if (BAD_PLATE_WORDS.has(p2Up)) continue;

      const p1Num = p1.startsWith("*") ? p1.slice(1) : p1;
      if (!/^\d+$/.test(p1Num)) continue;
      const code = parseInt(p1Num, 10);
      if (!(code >= 1 && code <= 81)) continue;
      if (p1Num.length === 1 && !p1.startsWith("*")) continue;

      const p2Clean = p2Up.replace(/İ/g, "I");
      if (!/^[A-Z]{1,3}$/.test(p2Clean)) continue;
      if (p3.length === 5) continue;

      const spaced = `${p1} ${p2Clean} ${p3}`;
      const compact = `${p1}${p2Clean}${p3}`;
      if (!seen.has(compact)) {
        seen.add(compact);
        found.push([spaced, compact]);
      }
    }
    return found;
  }

  function buildAptShortcuts(label) {
    const tokens = [];
    const re = /B(\d+)\/D(\d+)/gi;
    let m;
    while ((m = re.exec(label)) !== null) {
      const b = m[1];
      const d = m[2];
      tokens.push(
        `B${b}/D${d}`, `${b}/${d}`, `${b}-${d}`,
        `B${b}D${d}`, `b${b}d${d}`, `B${b} D${d}`,
        `Blok ${b} Daire ${d}`, `blok ${b} daire ${d}`
      );
    }
    if (label.includes("13ve17")) {
      tokens.push("B1/D13", "1/13", "1-13", "b1d13", "B1/D17", "1/17", "1-17", "b1d17");
    }
    return Array.from(new Set(tokens));
  }

  // ---------------- PDF.JS EXTRACTION ----------------

  function mulMat(m1, m2) {
    return [
      m1[0] * m2[0] + m1[2] * m2[1],
      m1[1] * m2[0] + m1[3] * m2[1],
      m1[0] * m2[2] + m1[2] * m2[3],
      m1[1] * m2[2] + m1[3] * m2[3],
      m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
      m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
    ];
  }

  function applyMat(m, x, y) {
    return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  }

  function normRgb(args) {
    if (!args || !args.length) return [0, 0, 0];
    if (args.length === 1) {
      const a = args[0];
      if (typeof a === "string" && a.startsWith("#") && a.length === 7) {
        return [
          parseInt(a.slice(1, 3), 16) / 255,
          parseInt(a.slice(3, 5), 16) / 255,
          parseInt(a.slice(5, 7), 16) / 255,
        ];
      }
      if (typeof a === "number") {
        const v = a > 1 ? a / 255 : a;
        return [v, v, v];
      }
    }
    if (args.length >= 3) {
      const [r, g, b] = args;
      if (r > 1 || g > 1 || b > 1) return [r / 255, g / 255, b / 255];
      return [r, g, b];
    }
    return [0, 0, 0];
  }

  async function extractPageWordsAndLines(page, pageH) {
    const tc = await page.getTextContent({ includeMarkedContent: false });
    const words = [];
    for (const item of tc.items) {
      const str = item.str;
      if (!str || !str.trim()) continue;
      const tr = item.transform;
      const tx = tr[4];
      const ty = tr[5];
      const fontH = Math.hypot(tr[2], tr[3]) || item.height || 8.3;
      const totalW = Math.max(0.1, item.width || str.length * fontH * 0.45);
      const yb = pageH - ty;
      const y0 = yb - fontH * 0.85;
      const y1 = yb + fontH * 0.15;
      const len = Math.max(1, str.length);

      const reWord = /\S+/g;
      let wm;
      while ((wm = reWord.exec(str)) !== null) {
        const wText = wm[0];
        const x0 = tx + (wm.index / len) * totalW;
        const x1 = tx + ((wm.index + wText.length) / len) * totalW;
        words.push({ x0, y0, x1, y1, text: wText, xc: (x0 + x1) / 2, yc: (y0 + y1) / 2 });
      }
    }

    words.sort((a, b) => (a.y0 - b.y0) || (a.x0 - b.x0));
    const lines = [];
    for (const w of words) {
      if (!lines.length || Math.abs(w.y0 - lines[lines.length - 1][0].y0) > 4.0) {
        lines.push([w]);
      } else {
        lines[lines.length - 1].push(w);
      }
    }
    for (const ln of lines) {
      ln.sort((a, b) => a.x0 - b.x0);
    }
    return { words, lines };
  }

  async function extractPageGraphics(page, pdfjsLib, pageH) {
    const OPS = pdfjsLib.OPS;
    const opList = await page.getOperatorList();
    const fnArray = opList.fnArray;
    const argsArray = opList.argsArray;

    let ctm = [1, 0, 0, 1, 0, 0];
    let fillRgb = [0, 0, 0];
    const stack = [];
    let pendingRects = [];
    const grayBars = [];
    const fillDraws = [];

    for (let i = 0; i < fnArray.length; i++) {
      const fn = fnArray[i];
      const args = argsArray[i];
      if (fn === OPS.save) {
        stack.push({ ctm: [...ctm], fillRgb: [...fillRgb] });
      } else if (fn === OPS.restore) {
        if (stack.length) {
          const st = stack.pop();
          ctm = st.ctm;
          fillRgb = st.fillRgb;
        }
        pendingRects = [];
      } else if (fn === OPS.transform) {
        ctm = mulMat(ctm, args);
      } else if (fn === OPS.setFillRGBColor) {
        fillRgb = normRgb(args);
      } else if (fn === OPS.setFillGray) {
        const v = args[0] > 1 ? args[0] / 255 : args[0];
        fillRgb = [v, v, v];
      } else if (fn === OPS.constructPath) {
        const ops = (args && args[0]) || [];
        const coords = (args && args[1]) || [];
        let ci = 0;
        let pts = [];
        for (let k = 0; k < ops.length; k++) {
          const sop = ops[k];
          if (sop === OPS.moveTo || sop === OPS.lineTo) {
            pts.push([coords[ci], coords[ci + 1]]);
            ci += 2;
          } else if (sop === OPS.curveTo) {
            ci += 6;
          } else if (sop === OPS.curveTo2 || sop === OPS.curveTo3) {
            ci += 4;
          } else if (sop === OPS.closePath) {
            if (pts.length >= 4) {
              const xs = pts.map((p) => p[0]);
              const ys = pts.map((p) => p[1]);
              const x0 = Math.min(...xs);
              const y0 = Math.min(...ys);
              pendingRects.push([x0, y0, Math.max(...xs) - x0, Math.max(...ys) - y0]);
            }
            pts = [];
          } else if (sop === OPS.rectangle) {
            pendingRects.push([coords[ci], coords[ci + 1], coords[ci + 2], coords[ci + 3]]);
            ci += 4;
          }
        }
      } else if (fn === OPS.rectangle) {
        pendingRects.push([args[0], args[1], args[2], args[3]]);
      } else if (fn === OPS.fill || fn === OPS.eoFill || fn === OPS.fillStroke || fn === OPS.eoFillStroke) {
        const [r, g, b] = fillRgb;
        const isWhite = r > 0.98 && g > 0.98 && b > 0.98;
        const isGray = 0.6 < r && r < 0.85 && Math.abs(r - g) < 0.05 && Math.abs(g - b) < 0.05;
        const isHighlightYellow = Math.round(r * 100) === 100 && Math.round(g * 100) === 100 && Math.round(b * 100) === 0;
        const isHighlightOrange = Math.round(r * 100) === 100 && Math.abs(g - 0.75) < 0.05 && Math.round(b * 100) === 0;

        for (const [rx, ry, rw, rh] of pendingRects) {
          const p1 = applyMat(ctm, rx, ry);
          const p2 = applyMat(ctm, rx + rw, ry + rh);
          const x0 = Math.min(p1[0], p2[0]);
          const x1 = Math.max(p1[0], p2[0]);
          const y0 = pageH - Math.max(p1[1], p2[1]);
          const y1 = pageH - Math.min(p1[1], p2[1]);
          const w = x1 - x0;
          const h = y1 - y0;
          if (isGray && w > 400 && h > 2 && h < 35) {
            grayBars.push([Number(y0.toFixed(2)), Number(y1.toFixed(2))]);
          }
          if (!isWhite && h >= 8 && w > 50) {
            fillDraws.push({
              x0, y0, x1, y1, width: w, height: h,
              highlight: isHighlightYellow ? "yellow" : (isHighlightOrange ? "orange" : null),
            });
          }
        }
        pendingRects = [];
      } else if (fn === OPS.clip || fn === OPS.eoClip || fn === OPS.endPath || fn === OPS.stroke || fn === OPS.closeStroke) {
        pendingRects = [];
      }
    }

    // Deduplicate and sort grayBars
    const barMap = new Map();
    for (const b of grayBars) {
      barMap.set(`${b[0]}_${b[1]}`, b);
    }
    const sortedBars = Array.from(barMap.values()).sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
    return { grayBars: sortedBars, fillDraws };
  }

  function joinWordsWithGaps(ws) {
    if (!ws || !ws.length) return "";
    const sorted = [...ws].sort((a, b) => a.x0 - b.x0);
    let s = sorted[0].text;
    for (let i = 1; i < sorted.length; i++) {
      const gap = sorted[i].x0 - sorted[i - 1].x1;
      s += (gap > 18 ? "   " : " ") + sorted[i].text;
    }
    return s;
  }

  function reconstructCol(ws) {
    if (!ws || !ws.length) return "";
    const sorted = [...ws].sort((a, b) => (a.y0 - b.y0) || (a.x0 - b.x0));
    const lines = [[sorted[0]]];
    let cy = sorted[0].yc;
    for (let i = 1; i < sorted.length; i++) {
      const w = sorted[i];
      if (Math.abs(w.yc - cy) <= 4.0) {
        lines[lines.length - 1].push(w);
      } else {
        lines.push([w]);
        cy = w.yc;
      }
    }
    return lines.map((ln) => joinWordsWithGaps(ln)).join("\n");
  }

  function detectSections(pagesMeta) {
    let p4Page = null, p4Y = null;
    let mailPage = null, mailY = null;
    let oturumPage = null, oturumY = null;

    for (let i = 0; i < pagesMeta.length; i++) {
      for (const ln of pagesMeta[i].lines) {
        const lineText = ln.map((w) => w.text).join(" ");
        const norm = toAsciiLower(lineText);
        if (p4Page === null && norm.includes("parsel 4 calisan firmalar")) {
          p4Page = i;
          p4Y = ln[0].y0;
        }
        if (mailPage === null && norm.includes("mail bildirimleri")) {
          mailPage = i;
          mailY = ln[0].y0;
        }
        if (oturumPage === null && norm.includes("koru oturum listesi")) {
          oturumPage = i;
          oturumY = ln[0].y0;
        }
      }
    }

    if (p4Page === null || mailPage === null || oturumPage === null) {
      throw new Error(
        "Seçilen PDF içinde beklenen bölümler (PARSEL 4 ÇALIŞAN FİRMALAR / MAİL BİLDİRİMLERİ / KORU OTURUM LİSTESİ) bulunamadı."
      );
    }

    const mBars = pagesMeta[mailPage].grayBars;
    const mailHdrBars = mBars.filter((b) => b[0] - 2.0 <= mailY && mailY <= b[1] + 2.0);
    let mailHdrBar = mailHdrBars[0];
    if (!mailHdrBar) {
      // Fallback if header sits just under/at yellow or gray boundary
      mailHdrBar = [mailY - 2.0, mailY + 9.0];
    }

    return { p4Page, p4Y, mailPage, mailY, mailHdrBar, oturumPage, oturumY };
  }

  function extractParsel4Firms(pagesMeta, secInfo) {
    const firms = new Map();
    const { p4Page, p4Y, mailPage, mailHdrBar } = secInfo;
    const mailBarY0 = mailHdrBar[0];

    for (let pIdx = p4Page; pIdx <= mailPage; pIdx++) {
      for (const ln of pagesMeta[pIdx].lines) {
        const y = ln[0].y0;
        if (pIdx === p4Page && y < p4Y + 8.5) continue;
        if (pIdx === mailPage && y >= mailBarY0 - 1.0) continue;

        const c0 = ln.filter((w) => w.xc < 258.2).map((w) => w.text).join(" ");
        const c1 = ln.filter((w) => w.xc >= 258.2 && w.xc < 353.0).map((w) => w.text).join(" ");
        let c2 = ln.filter((w) => w.xc >= 353.0).map((w) => w.text).join(" ");

        if (c0 && c1) {
          let isNew = false;
          let searchExtra = "";
          if (c1 === "AKSOY" && AKSOY_NEW_NAMES.has(c0)) {
            c2 = "19.11.26 Oğuzhan Şahin Onaylı (Aktif)";
            searchExtra = "19.11.2026 Oguzhan Sahin Onayli eklenmistir Kartlari aktif yeni";
            isNew = true;
          }
          if (!firms.has(c1)) firms.set(c1, []);
          firms.get(c1).push({
            name: c0,
            firm: c1,
            info: c2,
            searchExtra,
            isNew,
            page: pIdx + 1,
          });
        }
      }
    }
    return firms;
  }

  function extractPages13Sections(pagesMeta, secInfo) {
    const sections = [];
    let curSec = null;
    const startSec = (title) => {
      curSec = { title, rows: [] };
      sections.push(curSec);
    };

    const headersMap = {
      "KİPTAŞ": "KİPTAŞ",
      "MESA ASL FİRMALARININ PATRON VE YÖNETİM KURULUNA": "MESA ASL PATRON & YÖNETİM KURULU ARAÇ LİSTESİ",
      "MESA ASL": "MESA ASL PERSONEL LİSTESİ",
      "ÖZEL DAİRELER (ERAL / Mimtek )": "ÖZEL DAİRELER (ERAL / Mimtek Firması)",
      "ÖZEL DAİRELER (ERAL / Mimtek)": "ÖZEL DAİRELER (ERAL / Mimtek Firması)",
      "SATIŞ SONRASI MÜŞTERİ İLİŞKİLERİ EKİBİ": "SATIŞ SONRASI MÜŞTERİ İLİŞKİLERİ EKİBİ",
      "SATIŞ OFİSİ PERSONELİNE AİT ARAÇ BİLGİLERİ": "SATIŞ OFİSİ PERSONELİNE AİT ARAÇ BİLGİLERİ",
    };

    for (let pIdx = 0; pIdx <= secInfo.p4Page; pIdx++) {
      for (const ln of pagesMeta[pIdx].lines) {
        const y = ln[0].y0;
        if (pIdx === secInfo.p4Page && y >= secInfo.p4Y - 1.0) continue;

        const c0 = ln.filter((w) => w.xc < 258.2).map((w) => w.text).join(" ");
        const c1 = ln.filter((w) => w.xc >= 258.2 && w.xc < 353.0).map((w) => w.text).join(" ");
        const c2 = ln.filter((w) => w.xc >= 353.0 && w.xc < 416.2).map((w) => w.text).join(" ");
        const c3 = ln.filter((w) => w.xc >= 416.2).map((w) => w.text).join(" ");

        if (headersMap[c0]) {
          startSec(headersMap[c0]);
          continue;
        }
        if (!curSec || !c0) continue;

        let infoParts = [c1, c2, c3].filter(Boolean);
        if (pIdx === 0 && c0 === "TAYFUN GÖNENCİ") {
          infoParts = ["Erhan Bozkurt'tan gelmiştir."];
        } else if (pIdx === 0 && c0 === "HALİL İBRAHİM MEHMETOĞULLARI") {
          infoParts = [];
        } else if (pIdx === 0 && c0 === "Mert Bulutoğlu") {
          infoParts = ["Gece gündüz sürekli giriş yapabilir (Oğuzhan Şahin'den geldi)"];
        } else if (pIdx === 1 && curSec.title.startsWith("ÖZEL DAİRELER")) {
          infoParts = ["Mimtek Firması - Gece gündüz sürekli giriş yapabilir"];
        }

        curSec.rows.push({
          name: c0,
          firm: curSec.title.split(" ")[0],
          info: infoParts.join(" | "),
          page: pIdx + 1,
        });
      }
    }
    return sections;
  }

  function extractOturumListesi(pagesMeta, secInfo) {
    const rows = [];
    for (let pIdx = secInfo.oturumPage; pIdx < pagesMeta.length; pIdx++) {
      for (const ln of pagesMeta[pIdx].lines) {
        if (pIdx === secInfo.oturumPage && ln[0].y0 <= secInfo.oturumY + 18.0) continue;
        const c0 = ln.filter((w) => w.xc < 258.0).map((w) => w.text).join(" ");
        const c1 = ln.filter((w) => w.xc >= 258.0 && w.xc < 353.0).map((w) => w.text).join(" ");
        const c2 = ln.filter((w) => w.xc >= 353.0 && w.xc < 417.0).map((w) => w.text).join(" ");
        if (c1 || c2) {
          rows.push([c0, c1, c2]);
        }
      }
    }
    return rows;
  }

  function extractMailRecords(pagesMeta, secInfo) {
    const { mailPage, mailHdrBar, oturumPage, oturumY } = secInfo;
    const mailBarY1 = mailHdrBar[1];
    const rawSlices = [];
    const pageTopBar = {};

    for (let pIdx = mailPage; pIdx <= oturumPage; pIdx++) {
      const meta = pagesMeta[pIdx];
      const grayBars = meta.grayBars;
      const fillDraws = meta.fillDraws;
      const words = meta.words;
      const pageH = meta.height;

      pageTopBar[pIdx] = grayBars.some((b) => b[0] < 60.0);

      let startY;
      let bars;
      if (pIdx === mailPage) {
        startY = mailBarY1;
        bars = grayBars.filter((b) => b[0] > mailBarY1 - 0.5);
      } else if (pIdx === oturumPage) {
        startY = 54.5;
        bars = grayBars.filter((b) => b[1] < oturumY);
      } else {
        startY = 54.5;
        bars = grayBars;
      }

      let curY = startY;
      const regions = [];
      for (const [by0, by1] of bars) {
        if (by0 > curY + 1.0) {
          regions.push([curY, by0, true]);
        }
        curY = by1;
      }

      if (pIdx !== oturumPage && curY < 785.0) {
        const wordsAfter = words.filter((w) => w.yc >= curY - 0.5);
        if (wordsAfter.length) {
          const maxWy = Math.max(...wordsAfter.map((w) => w.y1));
          const drawsAfter = fillDraws.filter((d) => d.y0 >= curY - 1.0).map((d) => d.y1);
          const maxDy = drawsAfter.length ? Math.max(...drawsAfter) : curY;
          const endY = Number(Math.min(pageH - 53.0, Math.max(maxWy, maxDy) + 1.5).toFixed(2));
          regions.push([curY, endY, false]);
        }
      }

      // Split unseparated B3/D4 + PERSONEL LİSTESİ region if present
      const pHits = meta.lines.filter((ln) => ln.map((w) => w.text).join(" ").includes("PERSONEL LİSTESİ"));
      const finalRegions = [];
      for (const [ry0Orig, ry1, hasBar] of regions) {
        let ry0 = ry0Orig;
        // Skip tiny stray clipped descender fragments (< 2.5pt clipped under bar, seen on older exports)
        if (words.some((w) => w.y0 >= ry0 - 6 && w.y1 <= ry0 + 2 && w.yc >= ry0 - 0.5)) {
          // keep standard ry0 unless all top fragments have tiny height
        }
        let splitDone = false;
        for (const pln of pHits) {
          const py0 = pln[0].y0;
          if (ry0 + 10.0 < py0 && py0 < ry1 - 10.0) {
            const aboveTxt = words
              .filter((w) => w.y0 >= ry0 - 1.0 && w.y0 <= py0)
              .map((w) => w.text)
              .join(" ");
            if (aboveTxt.includes("3/4") || aboveTxt.includes("Nazlı")) {
              const splitY = Number((py0 - 2.0).toFixed(2));
              finalRegions.push([ry0, splitY, true]);
              finalRegions.push([splitY, ry1, hasBar]);
              splitDone = true;
              break;
            }
          }
        }
        if (!splitDone) {
          finalRegions.push([ry0, ry1, hasBar]);
        }
      }

      for (const [ry0, ry1, hasBar] of finalRegions) {
        const regWords = words.filter((w) => w.yc >= ry0 - 0.5 && w.yc <= ry1 + 0.5);
        if (!regWords.length) continue;

        const c0 = reconstructCol(regWords.filter((w) => w.xc < 258.2));
        const c1 = reconstructCol(regWords.filter((w) => w.xc >= 258.2 && w.xc < 353.0));
        const c2 = reconstructCol(regWords.filter((w) => w.xc >= 353.0 && w.xc < 416.2));
        const c3 = reconstructCol(regWords.filter((w) => w.xc >= 416.2));

        let sliceFill = null;
        for (const d of fillDraws) {
          if (d.y1 > ry0 + 2 && d.y0 < ry1 - 2 && d.highlight) {
            sliceFill = d.highlight;
            if (sliceFill === "yellow") break;
          }
        }

        rawSlices.push({
          idx: rawSlices.length,
          page: pIdx + 1,
          pIdx,
          srcW: meta.width,
          srcH: meta.height,
          y0: ry0,
          y1: ry1,
          hasBar,
          c0, c1, c2, c3,
          fill: sliceFill,
        });
      }
    }

    // Dynamic cross-page merge: merge iff next page does NOT start with a gray bar
    const records = [];
    let i = 0;
    while (i < rawSlices.length) {
      const s = rawSlices[i];
      const parts = [s];
      if (!s.hasBar && i + 1 < rawSlices.length) {
        const nxt = rawSlices[i + 1];
        if (nxt.pIdx === s.pIdx + 1 && !pageTopBar[nxt.pIdx]) {
          parts.push(nxt);
          i += 1;
        }
      }
      records.push(parts);
      i += 1;
    }
    return records;
  }

  function classifyRecord(parts, uniqueOwnerToCode) {
    const c0Raw = parts.map((p) => p.c0).filter(Boolean).join("\n").trim();
    const c0Norm = c0Raw.replace(/\s+/g, " ").trim();
    const c0Low = c0Norm.toLowerCase();
    const c0Ascii = toAsciiLower(c0Norm);
    const c1 = parts.map((p) => p.c1).filter(Boolean).join("\n").trim();
    const c2 = parts.map((p) => p.c2).filter(Boolean).join("\n").trim();
    const c3 = parts.map((p) => p.c3).filter(Boolean).join("\n").trim();
    const rightAll = `${c1} ${c2} ${c3}`.replace(/\s+/g, " ").trim();

    // Multi-apartment explicit rules
    if (/B10\/D6\s*(?:-|ve)\s*B8\/D3/i.test(rightAll) || c0Norm.includes("10. Blok Daire 6 ve 8. Blok Daire 3")) {
      return ["B8/D3 & B10/D6 (Çoklu)", [90, 8, 3]];
    }
    if (/B9\/D3\s*ve\s*B7\/D3/i.test(rightAll)) {
      return ["B7/D3 & B9/D3 (Çoklu)", [90, 7, 3]];
    }
    if (rightAll.includes("B1/13ve17")) {
      return ["B1/D13ve17", [1, 13, 17]];
    }
    if (c0Norm.includes("6-12,15-2 ve 14-1") || c0Norm.includes("15-2,14-1 ve 6-12")) {
      return ["B6/D12 - B14/D1 - B15/D2 (Çoklu)", [91, 6, 12]];
    }
    if (c0Norm.includes("14-1 ve 15-2 numaralı dairelerimizde")) {
      return ["B14/D1 - B15/D2 (Çoklu)", [91, 14, 1]];
    }
    if (c0Norm.includes("Blok 7 ve blok 16") && rightAll.includes("Arif Bayraktar")) {
      return ["B7/D13 & B16/D11 (Çoklu)", [91, 7, 13]];
    }
    if (c0Norm.includes("Blok -15 Daire 11-15-23")) {
      return ["B9/D23 & B15/D11-15-23 (Çoklu)", [91, 9, 23]];
    }

    // Standard Bxx/Dyy in c1 or c2
    const mStd = /\bB(\d+)\s*[/-]\s*D?(\d+)\b/i.exec(`${c1} ${c2}`);
    if (mStd) {
      const blk = parseInt(mStd[1], 10);
      const d = parseInt(mStd[2], 10);
      return [`B${blk}/D${d}`, [blk, d, 0]];
    }

    // Established sender/text mappings
    if (c0Low.includes("blok2/6")) return ["B2/D6", [2, 6, 0]];
    if (c0Norm.includes("2. Blok, daire 10") || c0Norm.includes("2. Blok daire 10")) return ["B2/D10", [2, 10, 0]];
    if (c0Norm.includes("B- Blok D:21") && rightAll.includes("Şengül Abaylı")) return ["B3/D21", [3, 21, 0]];
    if (rightAll.includes("Emir Gönül")) return ["B4/D7", [4, 7, 0]];
    if (c0Low.includes("blok 6 daire 8")) return ["B6/D8", [6, 8, 0]];
    if (
      c0Norm.includes("6-12 dairemizde cam montajı") ||
      c0Norm.includes("6-12 perde için") ||
      c0Norm.includes("6-12 numaralı dairemiz için paslanmaz")
    ) {
      return ["B6/D12", [6, 12, 0]];
    }
    if (c0Norm.includes("Mert Özlenir")) return ["B8/D12", [8, 12, 0]];
    if (c0Norm.includes("Emir Özkök")) return ["B9/D6", [9, 6, 0]];
    if (c0Norm.includes("Levent Şişman")) return ["B9/D24", [9, 24, 0]];
    if (c0Norm.includes("Kutal Mimarlık") || (c0Norm.includes("SML Mimarlık") && c0Norm.includes("alçıpan tamir"))) {
      return ["B10/D7", [10, 7, 0]];
    }
    if (c0Norm.includes("Onur Dosdoğru")) return ["B11/D9", [11, 9, 0]];
    if (c0Low.includes("14-1 numaralı dairemizde")) return ["B14/D1", [14, 1, 0]];
    if (c0Norm.includes("B15-5")) return ["B15/D5", [15, 5, 0]];
    if (c0Low.includes("16 blok 11 nolu dairemiz")) return ["B16/D11", [16, 11, 0]];
    if (c0Norm.includes("esel.cekin@gmail.com") || (c0Norm.includes("Yağız") && c0Norm.includes("FoliStudio"))) {
      return ["B16/D19", [16, 19, 0]];
    }

    // Future-proof generic Turkish blank-c1 apartment detection
    const genericPatterns = [
      /(?:\bkoru\s*)?(\d{1,2})\.?\s*blok[\s,/-]+(?:daire|d\.?)[\s:.-]*(\d{1,2})\b/,
      /\bblok\s*[-:]?\s*(\d{1,2})[\s,/-]+(?:daire|d\.?)[\s:.-]*(\d{1,2})\b/,
      /\b(\d{1,2})\s*\.?\s*blok\s+(\d{1,2})\s*(?:nolu|numarali)\b/,
      /\b(\d{1,2})\s*[-/]\s*(\d{1,2})\s*(?:nolu|numarali|daire|dairemiz|evimiz|evimize|perde)\b/,
    ];
    for (const pat of genericPatterns) {
      const gm = pat.exec(c0Ascii);
      if (gm) {
        const blk = parseInt(gm[1], 10);
        const d = parseInt(gm[2], 10);
        if (blk >= 1 && blk <= 16 && d >= 1 && d <= 35) {
          return [`B${blk}/D${d}`, [blk, d, 0]];
        }
      }
    }

    // Unique Oturum owner name fallback in c2
    if (c2 && uniqueOwnerToCode) {
      const c2Ascii = toAsciiLower(c2).replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
      if (c2Ascii.length >= 6 && uniqueOwnerToCode.has(c2Ascii)) {
        const [blk, d] = uniqueOwnerToCode.get(c2Ascii);
        return [`B${blk}/D${d}`, [blk, d, 0]];
      }
    }

    return ["Genel / Blok Belirtilmemiş", [99, 0, 0]];
  }

  // ---------------- PDF-LIB DRAWING HELPERS ----------------

  function ensureHelvOnPage(page, helvFont) {
    if (!page._koruHelvKey) {
      page._koruHelvKey = page.node.newFontDictionary(helvFont.name, helvFont.ref);
    }
    return page._koruHelvKey;
  }

  function insertHiddenSearchLayer(page, helvFont, rectTD, textStr, PDFLib) {
    const asciiSafe = toPrintableAscii(textStr);
    if (!asciiSafe) return;
    page._koruSearch = (page._koruSearch || "") + " " + asciiSafe.toLowerCase();

    const {
      pushGraphicsState, popGraphicsState, beginText, endText,
      moveText, setFontAndSize, setTextRenderingMode, showText, TextRenderingMode,
    } = PDFLib;

    const fontKey = ensureHelvOnPage(page, helvFont);
    const boxW = Math.max(20, rectTD.x1 - rectTD.x0);
    const boxH = Math.max(6, rectTD.y1 - rectTD.y0);

    let chosenFs = 1.5;
    let chosenLines = [];
    for (const fs of [4.0, 2.5, 1.5]) {
      const maxCharsPerLine = Math.max(12, Math.floor(boxW / (fs * 0.52)));
      const maxLines = Math.max(1, Math.floor(boxH / (fs * 1.08)));
      const lines = [];
      let cur = "";
      for (const word of asciiSafe.split(/\s+/)) {
        if (!cur) {
          cur = word;
        } else if (cur.length + 1 + word.length <= maxCharsPerLine) {
          cur += " " + word;
        } else {
          lines.push(cur);
          cur = word;
        }
      }
      if (cur) lines.push(cur);
      chosenFs = fs;
      chosenLines = lines.slice(0, maxLines);
      if (lines.length <= maxLines) break;
    }

    const stepY = chosenFs * 1.08;
    const startY_BU = PH - (rectTD.y0 + chosenFs + 0.5);
    const ops = [
      pushGraphicsState(),
      setTextRenderingMode(TextRenderingMode.Invisible),
      beginText(),
      setFontAndSize(fontKey, chosenFs),
      moveText(rectTD.x0, startY_BU),
    ];

    for (let i = 0; i < chosenLines.length; i++) {
      if (i > 0) ops.push(moveText(0, -stepY));
      ops.push(showText(helvFont.encodeText(chosenLines[i])));
    }
    ops.push(endText(), setTextRenderingMode(TextRenderingMode.Fill), popGraphicsState());
    page.pushOperators(...ops);
  }

  function addInternalLinkTD(outDoc, page, rectTD, targetPage, targetY_TD) {
    const destY = Number(Math.max(0, PH - targetY_TD).toFixed(2));
    const annotDict = outDoc.context.obj({
      Type: "Annot",
      Subtype: "Link",
      P: page.ref,
      H: "I",
      F: 4,
      Rect: [
        Number(rectTD.x0.toFixed(2)),
        Number((PH - rectTD.y1).toFixed(2)),
        Number(rectTD.x1.toFixed(2)),
        Number((PH - rectTD.y0).toFixed(2)),
      ],
      Border: [0, 0, 0],
      BS: { W: 0 },
      A: {
        Type: "Action",
        S: "GoTo",
        D: [targetPage.ref, "XYZ", 0, destY, 0],
      },
    });
    page.node.addAnnot(outDoc.context.register(annotDict));

    if (!page._koruLinks) page._koruLinks = [];
    page._koruLinks.push({
      x0: Number(rectTD.x0.toFixed(1)),
      y0: Number(rectTD.y0.toFixed(1)),
      x1: Number(rectTD.x1.toFixed(1)),
      y1: Number(rectTD.y1.toFixed(1)),
      targetPageObj: targetPage,
      targetY: Number(targetY_TD.toFixed(1)),
    });
  }

  function extractPageInteractiveMeta(allPages) {
    return allPages.map((p) => {
      const links = (p._koruLinks || []).map((lnk) => ({
        x0: lnk.x0,
        y0: lnk.y0,
        x1: lnk.x1,
        y1: lnk.y1,
        targetPage: allPages.indexOf(lnk.targetPageObj) + 1,
        targetY: lnk.targetY,
      }));
      return {
        links,
        searchText: (p._koruSearch || "").replace(/\s+/g, " ").trim(),
      };
    });
  }

  function drawRectTD(page, rectTD, opts, PDFLib) {
    const { rgb } = PDFLib;
    const h = rectTD.y1 - rectTD.y0;
    const drawOpts = {
      x: rectTD.x0,
      y: PH - rectTD.y1,
      width: rectTD.x1 - rectTD.x0,
      height: h,
    };
    if (opts.fill) drawOpts.color = rgb(opts.fill[0], opts.fill[1], opts.fill[2]);
    if (opts.border) {
      drawOpts.borderColor = rgb(opts.border[0], opts.border[1], opts.border[2]);
      drawOpts.borderWidth = opts.borderWidth || 0.6;
    } else {
      drawOpts.borderWidth = 0;
    }
    page.drawRectangle(drawOpts);
  }

  function drawTextTD(page, text, x, yBaselineTD, size, font, colorTuple, PDFLib) {
    const { rgb } = PDFLib;
    if (!page._koruFontKeys) page._koruFontKeys = new Map();
    let fKey = page._koruFontKeys.get(font);
    if (!fKey) {
      fKey = page.node.newFontDictionary(font.name, font.ref);
      page._koruFontKeys.set(font, fKey);
    }
    page.font = font;
    page.fontKey = fKey;
    page.drawText(String(text), {
      x,
      y: PH - yBaselineTD,
      size,
      color: rgb(colorTuple[0], colorTuple[1], colorTuple[2]),
    });
  }

  function setPdfOutlines(outDoc, items, PDFLib) {
    // items: [{ level: 1|2, title, page, yTD }]
    if (!items || !items.length) return;
    const { PDFName, PDFHexString, PDFNumber } = PDFLib;
    const ctx = outDoc.context;
    const rootRef = ctx.nextRef();

    // Group into level-1 nodes with optional level-2 children
    const tree = [];
    for (const item of items) {
      const node = {
        title: item.title,
        page: item.page,
        yBU: item.yTD != null ? Math.max(0, PH - item.yTD) : PH,
        ref: ctx.nextRef(),
        children: [],
      };
      if (item.level === 2 && tree.length > 0) {
        tree[tree.length - 1].children.push(node);
      } else {
        tree.push(node);
      }
    }

    let totalVisible = 0;
    for (let i = 0; i < tree.length; i++) {
      const n = tree[i];
      totalVisible += 1;
      const dictObj = {
        Title: PDFHexString.fromText(n.title),
        Parent: rootRef,
        Dest: [n.page.ref, "XYZ", 0, n.yBU, null],
      };
      if (i > 0) dictObj.Prev = tree[i - 1].ref;
      if (i < tree.length - 1) dictObj.Next = tree[i + 1].ref;

      if (n.children.length > 0) {
        dictObj.First = n.children[0].ref;
        dictObj.Last = n.children[n.children.length - 1].ref;
        dictObj.Count = PDFNumber.of(n.children.length);
        totalVisible += n.children.length;

        for (let j = 0; j < n.children.length; j++) {
          const ch = n.children[j];
          const chDict = {
            Title: PDFHexString.fromText(ch.title),
            Parent: n.ref,
            Dest: [ch.page.ref, "XYZ", 0, ch.yBU, null],
          };
          if (j > 0) chDict.Prev = n.children[j - 1].ref;
          if (j < n.children.length - 1) chDict.Next = n.children[j + 1].ref;
          ctx.assign(ch.ref, ctx.obj(chDict));
        }
      }
      ctx.assign(n.ref, ctx.obj(dictObj));
    }

    ctx.assign(
      rootRef,
      ctx.obj({
        Type: "Outlines",
        First: tree[0].ref,
        Last: tree[tree.length - 1].ref,
        Count: PDFNumber.of(totalVisible),
      })
    );
    outDoc.catalog.set(PDFName.of("Outlines"), rootRef);
  }

  // ---------------- PDF BUILDERS ----------------

  async function buildFirmsPdf(firmsMap, p13Sections, dateBadge, deps) {
    const { PDFLib, fontkit, fontRegularBytes, fontBoldBytes } = deps;
    const out = await PDFLib.PDFDocument.create();
    out.registerFontkit(fontkit);
    const fReg = await out.embedFont(fontRegularBytes, { subset: true });
    const fBold = await out.embedFont(fontBoldBytes, { subset: true });
    const fHelv = await out.embedFont(PDFLib.StandardFonts.Helvetica);

    const sortedFirmNames = Array.from(firmsMap.keys()).sort(compareTr);
    const allEmployees = [];
    for (const fn of sortedFirmNames) allEmployees.push(...firmsMap.get(fn));
    const allEmployeesAz = [...allEmployees].sort((a, b) => compareTr(a.name, b.name));

    // Page count for Fihrist (30 firms -> 1 page; auto-spills if >30)
    const FIRST_PAGE_CARDS = 30;
    const EXTRA_PAGE_CARDS = 38;
    const numIndexPages = sortedFirmNames.length <= FIRST_PAGE_CARDS
      ? 1
      : 1 + Math.ceil((sortedFirmNames.length - FIRST_PAGE_CARDS) / EXTRA_PAGE_CARDS);

    const indexPages = [];
    for (let i = 0; i < numIndexPages; i++) indexPages.push(out.addPage([PW, PH]));

    const TOP_Y = 48.0;
    const BOT_Y = 795.0;
    const ROW_H = 16.5;
    const HDR_H = 22.0;
    const TH_H = 16.0;

    const firmTargets = new Map();
    let curPage = out.addPage([PW, PH]);
    let curY = TOP_Y;

    const newPage = () => {
      const p = out.addPage([PW, PH]);
      curY = TOP_Y;
      return p;
    };

    const drawTableHeader = (page, y, cols) => {
      drawRectTD(page, { x0: 42.0, y0: y, x1: 553.0, y1: y + TH_H }, { fill: [0.16, 0.22, 0.30] }, PDFLib);
      for (const [x, lbl] of cols) {
        drawTextTD(page, lbl, x, y + 11.5, 8.2, fBold, [1, 1, 1], PDFLib);
      }
      return y + TH_H;
    };

    const colsFirm = [
      [47.0, "#"],
      [70.0, "Çalışan Adı Soyadı"],
      [266.0, "Firma"],
      [358.0, "Kod / TC / Bilgi"],
      [518.0, "Sayfa"],
    ];

    // Section 1: Firms & Employees
    for (const fname of sortedFirmNames) {
      const emps = firmsMap.get(fname);
      const pgsStr = Array.from(new Set(emps.map((e) => e.page))).sort((a, b) => a - b).join(", ");

      const neededMin = HDR_H + TH_H + Math.min(2, emps.length) * ROW_H + 6.0;
      if (curY + neededMin > BOT_Y) curPage = newPage();

      firmTargets.set(fname, [curPage, Math.max(20.0, curY - 4.0)]);

      drawRectTD(
        curPage,
        { x0: 42.0, y0: curY, x1: 553.0, y1: curY + HDR_H },
        { fill: [1.0, 0.945, 0.80], border: [0.82, 0.58, 0.0], borderWidth: 0.8 },
        PDFLib
      );
      drawTextTD(
        curPage,
        `${fname}  —  ${emps.length} Çalışan   (Orijinal Sayfa: ${pgsStr})`,
        48.0,
        curY + 14.8,
        10.2,
        fBold,
        [0.38, 0.20, 0.0],
        PDFLib
      );
      insertHiddenSearchLayer(
        curPage,
        fHelv,
        { x0: 44.0, y0: curY + 1.0, x1: 550.0, y1: curY + HDR_H - 1.0 },
        `${toAsciiLower(fname)} ${fname}`,
        PDFLib
      );
      curY += HDR_H + 1.0;
      curY = drawTableHeader(curPage, curY, colsFirm);

      for (let i = 0; i < emps.length; i++) {
        const emp = emps[i];
        if (curY + ROW_H > BOT_Y) {
          curPage = newPage();
          drawRectTD(
            curPage,
            { x0: 42.0, y0: curY, x1: 553.0, y1: curY + 18.0 },
            { fill: [1.0, 0.96, 0.87], border: [0.82, 0.58, 0.0], borderWidth: 0.5 },
            PDFLib
          );
          drawTextTD(
            curPage,
            `${fname} (Devamı — ${emps.length} Çalışan)`,
            48.0,
            curY + 12.5,
            8.8,
            fBold,
            [0.38, 0.20, 0.0],
            PDFLib
          );
          curY += 19.0;
          curY = drawTableHeader(curPage, curY, colsFirm);
        }

        const bg = emp.isNew ? [1.0, 0.975, 0.88] : ((i + 1) % 2 === 0 ? [0.97, 0.98, 0.995] : [1.0, 1.0, 1.0]);
        drawRectTD(
          curPage,
          { x0: 42.0, y0: curY, x1: 553.0, y1: curY + ROW_H },
          { fill: bg, border: [0.85, 0.88, 0.91], borderWidth: 0.4 },
          PDFLib
        );
        const infoTxt = emp.info || "";
        const infoFs = infoTxt.length > 22 ? 7.2 : 8.5;

        drawTextTD(curPage, String(i + 1), 47.0, curY + 11.8, 8.3, fReg, [0.4, 0.45, 0.5], PDFLib);
        drawTextTD(curPage, truncText(emp.name, 32), 70.0, curY + 11.8, 8.8, fBold, [0.08, 0.1, 0.14], PDFLib);
        drawTextTD(curPage, truncText(emp.firm, 16), 266.0, curY + 11.8, 8.3, fBold, [0.12, 0.31, 0.47], PDFLib);
        drawTextTD(curPage, truncText(infoTxt, 40), 358.0, curY + 11.8, infoFs, fReg, [0.2, 0.2, 0.2], PDFLib);
        drawTextTD(curPage, `S.${emp.page}`, 522.0, curY + 11.8, 8.0, fReg, [0.4, 0.45, 0.5], PDFLib);

        insertHiddenSearchLayer(
          curPage,
          fHelv,
          { x0: 44.0, y0: curY + 1.0, x1: 550.0, y1: curY + ROW_H - 1.0 },
          `${toAsciiLower(emp.name)} ${toAsciiLower(emp.firm)} ${toAsciiLower(infoTxt)} ${emp.searchExtra || ""}`,
          PDFLib
        );
        curY += ROW_H;
      }
      curY += 9.0;
    }

    // Section 2: A-Z Directory
    let azPage = out.addPage([PW, PH]);
    const azStartPage = azPage;
    let y = TOP_Y;
    drawRectTD(
      azPage,
      { x0: 42.0, y0: y, x1: 553.0, y1: y + 22.0 },
      { fill: [0.88, 0.93, 0.99], border: [0.12, 0.31, 0.55], borderWidth: 0.7 },
      PDFLib
    );
    drawTextTD(
      azPage,
      `A–Z TÜM ÇALIŞANLAR -> FİRMA REHBERİ (Parsel 4 — Toplam ${allEmployeesAz.length} Kişi)`,
      48.0,
      y + 14.8,
      10.0,
      fBold,
      [0.10, 0.24, 0.45],
      PDFLib
    );
    y += 24.0;
    const colsAz = [
      [47.0, "#"],
      [72.0, "Çalışan Adı Soyadı"],
      [262.0, "Firma (Dokun -> Git)"],
      [362.0, "Kod / TC / Bilgi"],
      [512.0, "Git"],
    ];
    y = drawTableHeader(azPage, y, colsAz);

    const allPagesRef = () => out.getPages();
    const pageOneBased = (p) => allPagesRef().indexOf(p) + 1;

    for (let i = 0; i < allEmployeesAz.length; i++) {
      const emp = allEmployeesAz[i];
      if (y + ROW_H > BOT_Y) {
        azPage = out.addPage([PW, PH]);
        y = TOP_Y;
        y = drawTableHeader(azPage, y, colsAz);
      }
      const bg = emp.isNew ? [1.0, 0.975, 0.88] : ((i + 1) % 2 === 0 ? [0.97, 0.98, 0.995] : [1.0, 1.0, 1.0]);
      const rRect = { x0: 42.0, y0: y, x1: 553.0, y1: y + ROW_H };
      drawRectTD(azPage, rRect, { fill: bg, border: [0.86, 0.88, 0.91], borderWidth: 0.4 }, PDFLib);

      const [tgtPage, tgtY] = firmTargets.get(emp.firm);
      const tgtPNum = pageOneBased(tgtPage);
      const infoTxt = emp.info || "";
      const infoFs = infoTxt.length > 22 ? 7.0 : 8.2;

      drawTextTD(azPage, String(i + 1), 47.0, y + 11.8, 8.0, fReg, [0.45, 0.48, 0.52], PDFLib);
      drawTextTD(azPage, truncText(emp.name, 31), 72.0, y + 11.8, 8.6, fBold, [0.08, 0.1, 0.14], PDFLib);
      drawTextTD(azPage, truncText(emp.firm, 16), 262.0, y + 11.8, 8.2, fBold, [0.05, 0.35, 0.68], PDFLib);
      drawTextTD(azPage, truncText(infoTxt, 38), 362.0, y + 11.8, infoFs, fReg, [0.2, 0.2, 0.2], PDFLib);
      drawTextTD(azPage, `S.${tgtPNum} ->`, 512.0, y + 11.8, 8.0, fBold, [0.05, 0.38, 0.72], PDFLib);

      addInternalLinkTD(out, azPage, rRect, tgtPage, tgtY);
      insertHiddenSearchLayer(
        azPage,
        fHelv,
        { x0: 44.0, y0: y + 1.0, x1: 550.0, y1: y + ROW_H - 1.0 },
        `${toAsciiLower(emp.name)} ${toAsciiLower(emp.firm)} ${toAsciiLower(infoTxt)} ${emp.searchExtra || ""}`,
        PDFLib
      );
      y += ROW_H;
    }

    // Section 3: Pages 1-3 Mesa ASL & Kiptas
    let mPage = out.addPage([PW, PH]);
    const p13StartPage = mPage;
    y = TOP_Y;
    for (const sec of p13Sections) {
      const rows = sec.rows;
      if (y + HDR_H + TH_H + Math.min(2, rows.length) * ROW_H > BOT_Y) {
        mPage = out.addPage([PW, PH]);
        y = TOP_Y;
      }
      drawRectTD(
        mPage,
        { x0: 42.0, y0: y, x1: 553.0, y1: y + HDR_H },
        { fill: [0.90, 0.98, 0.93], border: [0.0, 0.52, 0.28], borderWidth: 0.7 },
        PDFLib
      );
      drawTextTD(mPage, `${sec.title}  (${rows.length} Kayıt)`, 48.0, y + 14.8, 9.5, fBold, [0.0, 0.38, 0.2], PDFLib);
      y += HDR_H + 1.0;
      const colsM = [[47.0, "#"], [72.0, "Ad Soyad"], [295.0, "Plaka / Kod / Telefon / Bilgi"], [516.0, "Sayfa"]];
      y = drawTableHeader(mPage, y, colsM);
      for (let idxR = 0; idxR < rows.length; idxR++) {
        const rw = rows[idxR];
        if (y + ROW_H > BOT_Y) {
          mPage = out.addPage([PW, PH]);
          y = TOP_Y;
          y = drawTableHeader(mPage, y, colsM);
        }
        const bg = (idxR + 1) % 2 === 0 ? [0.97, 0.98, 0.995] : [1.0, 1.0, 1.0];
        drawRectTD(mPage, { x0: 42.0, y0: y, x1: 553.0, y1: y + ROW_H }, { fill: bg, border: [0.86, 0.88, 0.91], borderWidth: 0.4 }, PDFLib);
        drawTextTD(mPage, String(idxR + 1), 47.0, y + 11.8, 8.0, fReg, [0.45, 0.48, 0.52], PDFLib);
        drawTextTD(mPage, truncText(rw.name, 36), 72.0, y + 11.8, 8.6, fBold, [0.08, 0.1, 0.14], PDFLib);
        drawTextTD(mPage, truncText(rw.info, 54), 295.0, y + 11.8, 8.0, fReg, [0.2, 0.2, 0.2], PDFLib);
        drawTextTD(mPage, `S.${rw.page}`, 522.0, y + 11.8, 8.0, fReg, [0.4, 0.45, 0.5], PDFLib);
        insertHiddenSearchLayer(
          mPage,
          fHelv,
          { x0: 44.0, y0: y + 1.0, x1: 550.0, y1: y + ROW_H - 1.0 },
          `${toAsciiLower(sec.title)} ${toAsciiLower(rw.name)} ${toAsciiLower(rw.info)}`,
          PDFLib
        );
        y += ROW_H;
      }
      y += 9.0;
    }

    // Populate Index Page 1 (+ optional spillover page)
    const idxPage = indexPages[0];
    drawRectTD(idxPage, { x0: 42.0, y0: 22.0, x1: 553.0, y1: 74.0 }, { fill: [0.145, 0.247, 0.404], border: [0.75, 0.50, 0.0], borderWidth: 0.8 }, PDFLib);
    drawTextTD(idxPage, "PARSEL 4 — ÇALIŞAN FİRMALAR & PERSONEL MOBİL REHBERİ", 52.0, 44.0, 12.6, fBold, [1, 1, 1], PDFLib);
    drawTextTD(
      idxPage,
      `Güncel Liste (${dateBadge})  |  ${sortedFirmNames.length} Firma & ${allEmployees.length} Çalışan  |  Tek Dokunuşla Erişim`,
      52.0,
      62.0,
      8.1,
      fReg,
      [0.88, 0.93, 1.0],
      PDFLib
    );

    drawRectTD(idxPage, { x0: 42.0, y0: 80.0, x1: 553.0, y1: 108.0 }, { fill: [1.0, 0.96, 0.85], border: [0.85, 0.65, 0.0], borderWidth: 0.7 }, PDFLib);
    drawTextTD(
      idxPage,
      "Telefonda Arama İpucu: Arama kutusuna Türkçe harfsiz firma adı (aksoy, ucay, hsdortkol, degisim, ikiiz)",
      50.0, 92.0, 7.9, fBold, [0.45, 0.25, 0.0], PDFLib
    );
    drawTextTD(
      idxPage,
      "veya çalışan adı/kodu (abdulselam, dilhan) yazdığınızda doğrudan o firmanın satırına gider.",
      50.0, 103.0, 7.8, fReg, [0.35, 0.22, 0.05], PDFLib
    );

    const azPNum = pageOneBased(azStartPage);
    const p13PNum = pageOneBased(p13StartPage);
    const jBtns = [
      [{ x0: 42.0, y0: 114.0, x1: 292.0, y1: 138.0 }, `A–Z Çalışan Dizini (${allEmployeesAz.length} Kişi) -> S.${azPNum}`, azStartPage, [0.12, 0.31, 0.55], [0.91, 0.95, 1.0]],
      [{ x0: 303.0, y0: 114.0, x1: 553.0, y1: 138.0 }, `Mesa ASL & Kiptaş (S.1–3) -> S.${p13PNum}`, p13StartPage, [0.0, 0.52, 0.28], [0.90, 0.98, 0.93]],
    ];
    for (const [rect, btxt, tgtP, bcol, bfill] of jBtns) {
      drawRectTD(idxPage, rect, { fill: bfill, border: bcol, borderWidth: 0.9 }, PDFLib);
      drawTextTD(idxPage, btxt, rect.x0 + 10.0, rect.y0 + 15.5, 8.6, fBold, bcol, PDFLib);
      addInternalLinkTD(out, idxPage, rect, tgtP, 20.0);
    }
    drawTextTD(idxPage, "FİRMA FİHRİSTİ (Dokunarak Firmanın Çalışan Listesine Gidin)", 42.0, 154.0, 8.8, fBold, [0.2, 0.25, 0.32], PDFLib);

    const CARD_W = 250.0, CARD_H = 38.0, GAP_X = 11.0, GAP_Y = 4.0;
    for (let idxF = 0; idxF < sortedFirmNames.length; idxF++) {
      const fname = sortedFirmNames[idxF];
      const emps = firmsMap.get(fname);
      let targetIdxPage = indexPages[0];
      let localIdx = idxF;
      let startYC = 161.0;
      if (idxF >= FIRST_PAGE_CARDS) {
        const rem = idxF - FIRST_PAGE_CARDS;
        targetIdxPage = indexPages[1 + Math.floor(rem / EXTRA_PAGE_CARDS)];
        localIdx = rem % EXTRA_PAGE_CARDS;
        startYC = 48.0;
      }
      const colI = localIdx % 2;
      const rowI = Math.floor(localIdx / 2);
      const cx0 = 42.0 + colI * (CARD_W + GAP_X);
      const cy0 = startYC + rowI * (CARD_H + GAP_Y);
      const crect = { x0: cx0, y0: cy0, x1: cx0 + CARD_W, y1: cy0 + CARD_H };

      const hasNew = emps.some((e) => e.isNew);
      drawRectTD(
        targetIdxPage,
        crect,
        {
          fill: hasNew ? [1.0, 0.965, 0.86] : [0.975, 0.982, 0.992],
          border: hasNew ? [0.85, 0.62, 0.0] : [0.82, 0.85, 0.9],
          borderWidth: 0.6,
        },
        PDFLib
      );
      drawRectTD(
        targetIdxPage,
        { x0: cx0 + 3.0, y0: cy0 + 3.0, x1: cx0 + 126.0, y1: cy0 + CARD_H - 3.0 },
        { fill: hasNew ? [0.76, 0.45, 0.02] : [0.145, 0.28, 0.48] },
        PDFLib
      );
      drawTextTD(targetIdxPage, truncText(fname, 17), cx0 + 9.0, cy0 + 22.0, 9.0, fBold, [1, 1, 1], PDFLib);

      const [tgtPage, tgtY] = firmTargets.get(fname);
      const tgtPNum = pageOneBased(tgtPage);
      const pgsS = Array.from(new Set(emps.map((e) => e.page))).sort((a, b) => a - b).join(",");
      const cntLbl = hasNew ? `${emps.length} Çalışan (+4 Yeni)` : `${emps.length} Çalışan`;
      drawTextTD(targetIdxPage, cntLbl, cx0 + 134.0, cy0 + 16.5, 8.6, fBold, [0.12, 0.14, 0.18], PDFLib);
      drawTextTD(targetIdxPage, `Sayfa ${tgtPNum}  (Orij. S.${pgsS})`, cx0 + 134.0, cy0 + 29.0, 7.5, fReg, [0.35, 0.4, 0.48], PDFLib);

      addInternalLinkTD(out, targetIdxPage, crect, tgtPage, tgtY);
      insertHiddenSearchLayer(
        targetIdxPage,
        fHelv,
        { x0: cx0 + 4.0, y0: cy0 + 2.0, x1: cx0 + CARD_W - 4.0, y1: cy0 + CARD_H - 2.0 },
        toAsciiLower(fname),
        PDFLib
      );
    }

    // Top Nav Bar & Page Numbers
    const allPages = out.getPages();
    const totalPages = allPages.length;
    for (let pI = 0; pI < totalPages; pI++) {
      const p = allPages[pI];
      if (pI >= 1) {
        const navs = [
          [{ x0: 42.0, y0: 16.0, x1: 185.0, y1: 36.0 }, "Firma Fihristi (S.1)", allPages[0]],
          [{ x0: 193.0, y0: 16.0, x1: 345.0, y1: 36.0 }, `A-Z Kişi Dizini (S.${azPNum})`, azStartPage],
          [{ x0: 353.0, y0: 16.0, x1: 495.0, y1: 36.0 }, `Mesa & Kiptaş (S.${p13PNum})`, p13StartPage],
        ];
        for (const [nrect, nlbl, tgtP] of navs) {
          drawRectTD(p, nrect, { fill: [0.94, 0.96, 0.99], border: [0.75, 0.8, 0.88], borderWidth: 0.5 }, PDFLib);
          drawTextTD(p, nlbl, nrect.x0 + 10.0, 29.0, 8.0, fBold, [0.12, 0.31, 0.55], PDFLib);
          addInternalLinkTD(out, p, nrect, tgtP, 15.0);
        }
        drawTextTD(p, `S. ${pI + 1}/${totalPages}`, 508.0, 29.0, 8.2, fBold, [0.4, 0.45, 0.52], PDFLib);
      }
      drawTextTD(p, `Sayfa ${pI + 1} / ${totalPages}`, 272.0, 818.0, 8.2, fReg, [0.45, 0.45, 0.45], PDFLib);
    }

    // TOC Bookmarks
    const toc = [
      { level: 1, title: "Firma Fihristi (Ana Sayfa)", page: allPages[0], yTD: 0 },
      { level: 1, title: `Parsel 4 Firmalar (${sortedFirmNames.length} Firma)`, page: allPages[numIndexPages], yTD: 0 },
    ];
    for (const fname of sortedFirmNames) {
      const [tp, ty] = firmTargets.get(fname);
      toc.push({ level: 2, title: `${fname} (${firmsMap.get(fname).length})`, page: tp, yTD: ty });
    }
    toc.push({ level: 1, title: `A-Z Çalışan Dizini (${allEmployeesAz.length} Kişi)`, page: azStartPage, yTD: 0 });
    toc.push({ level: 1, title: "Mesa ASL & Kiptaş & Satış Ofisi (S.1-3)", page: p13StartPage, yTD: 0 });
    setPdfOutlines(out, toc, PDFLib);

    return {
      bytes: await out.save({ useObjectStreams: false }),
      pageMeta: extractPageInteractiveMeta(allPages),
    };
  }

  async function buildMobileBlokPdf(srcPdfBytes, srcNumPages, oturumFiltered, grouped, groupMeta, sortedPlates, sortedKeys, dateBadge, deps, onProgress) {
    const { PDFLib, fontkit, fontRegularBytes, fontBoldBytes } = deps;
    const out = await PDFLib.PDFDocument.create();
    out.registerFontkit(fontkit);
    const fReg = await out.embedFont(fontRegularBytes, { subset: true });
    const fBold = await out.embedFont(fontBoldBytes, { subset: true });
    const fHelv = await out.embedFont(PDFLib.StandardFonts.Helvetica);

    const srcLibDoc = await PDFLib.PDFDocument.load(srcPdfBytes);
    const srcPages = srcLibDoc.getPages();

    // Fihrist pages (40 cards on Page 1; spillover if >40)
    const FIRST_PAGE_CARDS = 40;
    const EXTRA_PAGE_CARDS = 44;
    const numIndexPages = sortedKeys.length <= FIRST_PAGE_CARDS
      ? 1
      : 1 + Math.ceil((sortedKeys.length - FIRST_PAGE_CARDS) / EXTRA_PAGE_CARDS);

    const indexPages = [];
    for (let i = 0; i < numIndexPages; i++) indexPages.push(out.addPage([PW, PH]));

    const OTURUM_PER_PAGE = 36;
    const numOturumPages = Math.max(1, Math.ceil(oturumFiltered.length / OTURUM_PER_PAGE));
    const oturumPages = [];
    for (let i = 0; i < numOturumPages; i++) oturumPages.push(out.addPage([PW, PH]));

    const groupTargets = new Map();
    const TOP_CONTENT_Y = 48.0;
    const BOT_CONTENT_Y = 790.0;

    let curPage = out.addPage([PW, PH]);
    let curY = TOP_CONTENT_Y;
    const newNotifPage = () => {
      curY = TOP_CONTENT_Y;
      return out.addPage([PW, PH]);
    };

    const allPagesRef = () => out.getPages();
    const pageOneBased = (p) => allPagesRef().indexOf(p) + 1;

    // Batch-embed all notification slices in one call so shared source fonts are copied ONCE (~10x smaller & faster)
    const sliceSrcPages = [];
    const sliceBoxes = [];
    const partToEmbIdx = new Map();
    for (const key of sortedKeys) {
      for (const item of grouped.get(key)) {
        for (const part of item.parts) {
          partToEmbIdx.set(part, sliceSrcPages.length);
          sliceSrcPages.push(srcPages[part.pIdx]);
          sliceBoxes.push({
            left: 0,
            right: part.srcW,
            bottom: Math.max(0, part.srcH - part.y1),
            top: Math.min(part.srcH, part.srcH - part.y0),
          });
        }
      }
    }
    const embeddedSlices = sliceSrcPages.length ? await out.embedPages(sliceSrcPages, sliceBoxes) : [];

    for (let kIdx = 0; kIdx < sortedKeys.length; kIdx++) {
      if (onProgress && kIdx % 6 === 0) {
        onProgress(70 + Math.round((kIdx / sortedKeys.length) * 18), `Blok 1–7 & 16 rehberi çiziliyor (${kIdx}/${sortedKeys.length})...`);
      }
      const key = sortedKeys[kIdx];
      const meta = groupMeta.get(key);
      const label = meta.label;
      const owner = meta.owner;
      const plates = meta.plates;
      const items = grouped.get(key);
      const isB6 = (label === "B6/D3");

      const platesStr = plates.map((p) => p[0]).join(" • ");
      const plateLines = [];
      if (platesStr) {
        let curLn = "Plakalar: ";
        for (let idxP = 0; idxP < plates.length; idxP++) {
          const sp = plates[idxP][0];
          const sep = idxP > 0 ? " • " : "";
          if (curLn.length + sep.length + sp.length > 88) {
            plateLines.push(curLn);
            curLn = "   " + sp;
          } else {
            curLn += sep + sp;
          }
        }
        if (curLn.trim()) plateLines.push(curLn);
      }

      const hdrH = 20.0 + plateLines.length * 11.0;
      const firstSliceH = items[0].parts[0].y1 - items[0].parts[0].y0;
      if (curY + hdrH + firstSliceH > BOT_CONTENT_Y) curPage = newNotifPage();

      groupTargets.set(label, [curPage, Math.max(20.0, curY - 4.0)]);

      const fillCol = isB6 ? [1.0, 0.949, 0.8] : [0.851, 0.882, 0.949];
      const borderCol = isB6 ? [0.85, 0.65, 0.0] : [0.557, 0.663, 0.859];
      const textCol = isB6 ? [0.45, 0.25, 0.0] : [0.122, 0.306, 0.471];

      drawRectTD(
        curPage,
        { x0: 51.0, y0: curY, x1: 544.0, y1: curY + hdrH },
        { fill: fillCol, border: borderCol, borderWidth: 0.7 },
        PDFLib
      );

      const mBd = /^B(\d+)\/D(\d+)$/.exec(label);
      const scDisp = mBd ? `(${mBd[1]}/${mBd[2]} • ${mBd[1]}-${mBd[2]})` : "";
      const ownerDisp = owner ? ` | Sahibi: ${truncText(owner, 42)}` : "";
      const hdrTitle = `${label} ${scDisp} — ${meta.count} Bildirim${ownerDisp}`;
      drawTextTD(curPage, hdrTitle, 56.0, curY + 13.0, 9.3, fBold, textCol, PDFLib);

      for (let plI = 0; plI < plateLines.length; plI++) {
        drawTextTD(curPage, plateLines[plI], 56.0, curY + 24.0 + plI * 11.0, 7.6, fReg, [0.25, 0.3, 0.38], PDFLib);
      }

      let hdrSearch = meta.shortcuts.join(" ") + " " + toAsciiLower(owner);
      for (const [sp, cp] of plates) {
        hdrSearch += ` ${sp} ${cp} ${sp.toLowerCase()} ${cp.toLowerCase()}`;
      }
      insertHiddenSearchLayer(
        curPage,
        fHelv,
        { x0: 52.0, y0: curY + 1.0, x1: 542.0, y1: curY + hdrH - 1.0 },
        hdrSearch,
        PDFLib
      );

      curY += hdrH + 2.0;

      for (let idxItem = 0; idxItem < items.length; idxItem++) {
        const parts = items[idxItem].parts;
        for (const part of parts) {
          const h = part.y1 - part.y0;
          if (curY + h > BOT_CONTENT_Y) curPage = newNotifPage();

          const sW = part.srcW;
          const embeddedSlice = embeddedSlices[partToEmbIdx.get(part)];
          curPage.drawPage(embeddedSlice, {
            x: 0,
            y: PH - (curY + h),
            width: sW,
            height: h,
          });

          // Source page micro-badge at right margin (x=500..544)
          let bRect = { x0: 500.0, y0: curY + 2.0, x1: 544.0, y1: Math.min(curY + h - 2.0, curY + 15.0) };
          if (bRect.y1 - bRect.y0 < 10.0) {
            bRect = { x0: 500.0, y0: curY + 1.0, x1: 544.0, y1: curY + 11.5 };
          }
          drawRectTD(curPage, bRect, { fill: [0.95, 0.96, 0.98], border: [0.84, 0.86, 0.9], borderWidth: 0.4 }, PDFLib);
          drawTextTD(curPage, `Orij. S.${part.page}`, 505.0, bRect.y0 + (bRect.y1 - bRect.y0) * 0.72, 6.7, fReg, [0.35, 0.4, 0.5], PDFLib);

          const rawSliceTxt = `${part.c0} ${part.c1} ${part.c2} ${part.c3}`;
          const slicePlates = extractPlates(`${part.c0} ${part.c1}`);
          const plateTokens = slicePlates.map(([sp, cp]) => `${sp} ${cp} ${sp.toLowerCase()} ${cp.toLowerCase()}`).join(" ");
          const hiddenTxt = [
            meta.shortcuts.join(" "),
            toAsciiLower(owner),
            toAsciiLower(rawSliceTxt),
            plateTokens,
          ].join(" ");

          insertHiddenSearchLayer(
            curPage,
            fHelv,
            { x0: 52.0, y0: curY + 1.0, x1: 495.0, y1: curY + h - 1.0 },
            hiddenTxt,
            PDFLib
          );

          curY += h;
        }

        if (idxItem < items.length - 1) {
          if (curY + 10.0 <= BOT_CONTENT_Y) {
            drawRectTD(curPage, { x0: 51.0, y0: curY - 0.3, x1: 544.0, y1: curY + 9.5 }, { fill: GRAY_RGB }, PDFLib);
            curY += 10.0;
          }
        } else {
          curY += 7.0;
        }
      }
    }

    // Build Plate Directory at the end
    const PLATE_ROW_H = 16.5;
    const PLATES_PER_PAGE = 42;
    const numPlatePages = Math.max(1, Math.ceil(sortedPlates.length / PLATES_PER_PAGE));
    const platePages = [];
    for (let i = 0; i < numPlatePages; i++) platePages.push(out.addPage([PW, PH]));
    const plateDirStartPage = platePages[0];
    const plateDirStartPNum = pageOneBased(plateDirStartPage);

    for (let ppI = 0; ppI < numPlatePages; ppI++) {
      const pPage = platePages[ppI];
      let py = TOP_CONTENT_Y;
      drawRectTD(pPage, { x0: 51.0, y0: py, x1: 544.0, y1: py + 22.0 }, { fill: [0.88, 0.92, 0.97], border: [0.18, 0.33, 0.59], borderWidth: 0.7 }, PDFLib);
      drawTextTD(pPage, `HIZLI PLAKA -> DAİRE ARAMA DİZİNİ (Blok 1–7 & Blok 16) — Toplam ${sortedPlates.length} Kayıt`, 56.0, py + 14.5, 9.7, fBold, [0.12, 0.25, 0.45], PDFLib);
      py += 26.0;

      drawRectTD(pPage, { x0: 51.0, y0: py, x1: 544.0, y1: py + 17.0 }, { fill: [0.2, 0.247, 0.31] }, PDFLib);
      for (const [x, hdrLbl] of [
        [56.0, "Plaka (Boşluklu)"],
        [142.0, "Bitişik"],
        [225.0, "Blok / Daire"],
        [315.0, "Daire Sahibi"],
        [492.0, "Git"],
      ]) {
        drawTextTD(pPage, hdrLbl, x, py + 12.0, 8.1, fBold, [1, 1, 1], PDFLib);
      }
      py += 18.0;

      const chunk = sortedPlates.slice(ppI * PLATES_PER_PAGE, (ppI + 1) * PLATES_PER_PAGE);
      for (let rI = 0; rI < chunk.length; rI++) {
        const [sp, cp, lbl, own] = chunk[rI];
        let bg = rI % 2 === 1 ? [0.97, 0.98, 0.995] : [1.0, 1.0, 1.0];
        if (lbl === "B6/D3") bg = [1.0, 0.97, 0.88];
        const rowRect = { x0: 51.0, y0: py, x1: 544.0, y1: py + PLATE_ROW_H };
        drawRectTD(pPage, rowRect, { fill: bg, border: [0.86, 0.88, 0.91], borderWidth: 0.4 }, PDFLib);

        const [tgtPage, tgtY] = groupTargets.get(lbl);
        const tgtPNum = pageOneBased(tgtPage);
        drawTextTD(pPage, sp, 56.0, py + 11.8, 8.3, fBold, [0.1, 0.1, 0.1], PDFLib);
        drawTextTD(pPage, cp, 142.0, py + 11.8, 8.1, fReg, [0.25, 0.25, 0.25], PDFLib);
        const lblDisp = lbl.replace(" (Çoklu)", "");
        drawTextTD(pPage, truncText(lblDisp, 19), 225.0, py + 11.8, 8.1, fBold, [0.12, 0.31, 0.47], PDFLib);
        drawTextTD(pPage, truncText(own, 32), 315.0, py + 11.8, 8.0, fReg, [0.2, 0.2, 0.2], PDFLib);
        drawTextTD(pPage, `S.${tgtPNum} ->`, 492.0, py + 11.8, 8.0, fBold, [0.05, 0.38, 0.72], PDFLib);

        addInternalLinkTD(out, pPage, rowRect, tgtPage, tgtY);
        insertHiddenSearchLayer(
          pPage,
          fHelv,
          { x0: 52.0, y0: py + 1.0, x1: 542.0, y1: py + PLATE_ROW_H - 1.0 },
          `${sp.toLowerCase()} ${cp.toLowerCase()} ${toAsciiLower(own)} ${buildAptShortcuts(lbl).join(" ")}`,
          PDFLib
        );
        py += PLATE_ROW_H;
      }
    }

    // Populate Index Page(s)
    const indexPage = indexPages[0];
    drawRectTD(indexPage, { x0: 42.0, y0: 22.0, x1: 553.0, y1: 74.0 }, { fill: [0.145, 0.247, 0.404], border: [0.12, 0.31, 0.47], borderWidth: 0.8 }, PDFLib);
    drawTextTD(indexPage, `KORU SİTESİ — BLOK 1–7 ve BLOK 16 MOBİL REHBER (${dateBadge})`, 52.0, 44.0, 12.1, fBold, [1, 1, 1], PDFLib);
    drawTextTD(
      indexPage,
      "Güncel Oturum Listesi + Mail Bildirimleri + Plaka Arama Dizini | Daireye dokunarak doğrudan ilgili kayda geçin",
      52.0, 62.0, 7.9, fReg, [0.88, 0.93, 1.0], PDFLib
    );

    drawRectTD(indexPage, { x0: 42.0, y0: 79.0, x1: 553.0, y1: 108.0 }, { fill: [1.0, 0.96, 0.85], border: [0.85, 0.65, 0.0], borderWidth: 0.7 }, PDFLib);
    drawTextTD(
      indexPage,
      "Telefonda Hızlı Arama İpucu: PDF arama kutusuna Türkçe harf kullanmadan isim (ozpinar, yigitoglu, sahin),",
      50.0, 91.5, 7.9, fBold, [0.45, 0.25, 0.0], PDFLib
    );
    drawTextTD(
      indexPage,
      "boşluklu veya bitişik plaka (34NJR212 / 34 NJR 212) ya da daire kısayolu (6/3, 6-3, b6d3) yazarak anında bulabilirsiniz.",
      50.0, 102.5, 7.8, fReg, [0.35, 0.22, 0.05], PDFLib
    );

    const oturumFirstPNum = pageOneBased(oturumPages[0]);
    const btnSpecs = [
      [{ x0: 42.0, y0: 113.0, x1: 292.0, y1: 136.0 }, `Koru Oturum Listesi (Blok 1–7 & 16) -> S.${oturumFirstPNum}`, oturumPages[0], [0.0, 0.55, 0.28], [0.9, 0.98, 0.93]],
      [{ x0: 303.0, y0: 113.0, x1: 553.0, y1: 136.0 }, `Toplu Plaka Arama Dizini (${sortedPlates.length} Plaka) -> S.${plateDirStartPNum}`, plateDirStartPage, [0.12, 0.31, 0.55], [0.91, 0.95, 1.0]],
    ];
    for (const [brect, btxt, tgtP, bcol, bfill] of btnSpecs) {
      drawRectTD(indexPage, brect, { fill: bfill, border: bcol, borderWidth: 0.9 }, PDFLib);
      drawTextTD(indexPage, btxt, brect.x0 + 10.0, brect.y0 + 15.0, 8.4, fBold, bcol, PDFLib);
      addInternalLinkTD(out, indexPage, brect, tgtP, 20.0);
    }

    drawTextTD(indexPage, `DAİRE BAZLI BİLDİRİMLER — ${sortedKeys.length} GRUP (Dokunarak İlgili Daireye Atlayın)`, 42.0, 148.5, 8.4, fBold, [0.2, 0.25, 0.32], PDFLib);

    const CARD_W = 250.0, CARD_H = 29.0, GAP_X = 11.0, GAP_Y = 2.8;
    const blockColors = {
      1: [0.16, 0.42, 0.72],
      2: [0.05, 0.52, 0.52],
      3: [0.28, 0.35, 0.68],
      4: [0.48, 0.28, 0.62],
      5: [0.15, 0.52, 0.30],
      6: [0.76, 0.48, 0.02],
      7: [0.75, 0.25, 0.25],
      16: [0.25, 0.32, 0.42],
    };

    for (let idxG = 0; idxG < sortedKeys.length; idxG++) {
      const key = sortedKeys[idxG];
      const meta = groupMeta.get(key);
      const label = meta.label;
      const owner = meta.owner;
      const plates = meta.plates;
      const blkNum = meta.sortKey[0];

      let targetIdxPage = indexPages[0];
      let localIdx = idxG;
      let startYCards = 154.0;
      if (idxG >= FIRST_PAGE_CARDS) {
        const rem = idxG - FIRST_PAGE_CARDS;
        targetIdxPage = indexPages[1 + Math.floor(rem / EXTRA_PAGE_CARDS)];
        localIdx = rem % EXTRA_PAGE_CARDS;
        startYCards = 48.0;
      }

      const colI = localIdx % 2;
      const rowI = Math.floor(localIdx / 2);
      const cx0 = 42.0 + colI * (CARD_W + GAP_X);
      const cy0 = startYCards + rowI * (CARD_H + GAP_Y);
      const crect = { x0: cx0, y0: cy0, x1: cx0 + CARD_W, y1: cy0 + CARD_H };

      const isB6 = (label === "B6/D3");
      const badgeCol = blockColors[blkNum] || [0.35, 0.35, 0.4];
      const cardBg = isB6 ? [1.0, 0.96, 0.84] : [0.975, 0.982, 0.992];
      const cardBd = isB6 ? [0.85, 0.62, 0.0] : [0.82, 0.85, 0.9];

      drawRectTD(targetIdxPage, crect, { fill: cardBg, border: cardBd, borderWidth: 0.6 }, PDFLib);
      drawRectTD(targetIdxPage, { x0: cx0 + 3.0, y0: cy0 + 2.5, x1: cx0 + 62.0, y1: cy0 + CARD_H - 2.5 }, { fill: badgeCol }, PDFLib);

      const mBd = /^B(\d+)\/D(\d+)$/.exec(label);
      if (mBd) {
        const shortCode = `${mBd[1]}/${mBd[2]}`;
        drawTextTD(targetIdxPage, label, cx0 + 8.0, cy0 + 13.0, 8.2, fBold, [1, 1, 1], PDFLib);
        drawTextTD(targetIdxPage, `(${shortCode})`, cx0 + 8.0, cy0 + 22.8, 6.9, fReg, [0.9, 0.95, 1.0], PDFLib);
      } else {
        const shortLbl = label.includes("13ve17") ? "B1/13-17" : (label.includes("Çoklu") ? "Çoklu" : (label.includes("Genel") ? "Genel" : label.slice(0, 8)));
        drawTextTD(targetIdxPage, shortLbl, cx0 + 7.0, cy0 + 17.0, 7.4, fBold, [1, 1, 1], PDFLib);
      }

      const [tgtPage, tgtY] = groupTargets.get(label);
      const tgtPNum = pageOneBased(tgtPage);
      const topTxt = owner || label;
      let subTxt = `${meta.count} Bildirim`;
      if (plates.length) subTxt += ` • ${plates.length} Plaka`;
      subTxt += `  (S.${tgtPNum})`;

      drawTextTD(targetIdxPage, truncText(topTxt, 30), cx0 + 68.0, cy0 + 12.2, 7.8, fBold, [0.12, 0.14, 0.18], PDFLib);
      drawTextTD(targetIdxPage, subTxt, cx0 + 68.0, cy0 + 23.0, 7.0, fReg, [0.35, 0.4, 0.48], PDFLib);

      addInternalLinkTD(out, targetIdxPage, crect, tgtPage, tgtY);
      insertHiddenSearchLayer(
        targetIdxPage,
        fHelv,
        { x0: cx0 + 4.0, y0: cy0 + 2.0, x1: cx0 + CARD_W - 4.0, y1: cy0 + CARD_H - 2.0 },
        `${meta.shortcuts.join(" ")} ${toAsciiLower(owner)}`,
        PDFLib
      );
    }

    // Populate Oturum Listesi Pages
    for (let opI = 0; opI < numOturumPages; opI++) {
      const opPage = oturumPages[opI];
      let oy = TOP_CONTENT_Y;
      drawRectTD(opPage, { x0: 51.0, y0: oy, x1: 544.0, y1: oy + 22.0 }, { fill: [0.9, 0.98, 0.93], border: [0.0, 0.55, 0.28], borderWidth: 0.7 }, PDFLib);
      drawTextTD(opPage, `KORU OTURUM LİSTESİ — BLOK 1–7 ve BLOK 16 (${oturumFiltered.length} Daire)`, 56.0, oy + 14.5, 10.0, fBold, [0.0, 0.42, 0.2], PDFLib);
      oy += 26.0;

      drawRectTD(opPage, { x0: 51.0, y0: oy, x1: 544.0, y1: oy + 17.0 }, { fill: [0.0, 0.62, 0.30] }, PDFLib);
      for (const [x, hdrLbl] of [
        [56.0, "Kod (Kısayol)"],
        [142.0, "İsim Soyisim / Firma"],
        [402.0, "Blok"],
        [436.0, "Daire"],
        [472.0, "Bildirim"],
      ]) {
        drawTextTD(opPage, hdrLbl, x, oy + 12.0, 8.1, fBold, [1, 1, 1], PDFLib);
      }
      oy += 18.0;

      const chunk = oturumFiltered.slice(opI * OTURUM_PER_PAGE, (opI + 1) * OTURUM_PER_PAGE);
      const ROW_H = 19.5;
      for (let rI = 0; rI < chunk.length; rI++) {
        const [name, blk, d] = chunk[rI];
        const code = `B${blk}/D${d}`;
        const bg = code === "B6/D3" ? [1.0, 0.96, 0.85] : (rI % 2 === 1 ? [0.965, 0.975, 0.985] : [1, 1, 1]);
        const rRect = { x0: 51.0, y0: oy, x1: 544.0, y1: oy + ROW_H };
        drawRectTD(opPage, rRect, { fill: bg, border: [0.85, 0.88, 0.9], borderWidth: 0.4 }, PDFLib);

        drawTextTD(opPage, `${code} (${blk}/${d})`, 56.0, oy + 13.0, 8.1, fBold, [0.12, 0.31, 0.47], PDFLib);
        drawTextTD(opPage, truncText(name, 46), 142.0, oy + 13.0, 8.1, fReg, [0.1, 0.1, 0.1], PDFLib);
        drawTextTD(opPage, String(blk), 406.0, oy + 13.0, 8.1, fBold, [0.75, 0.1, 0.1], PDFLib);
        drawTextTD(opPage, String(d), 442.0, oy + 13.0, 8.1, fReg, [0.1, 0.1, 0.1], PDFLib);

        if (groupTargets.has(code)) {
          const [tgtPage, tgtY] = groupTargets.get(code);
          let cnt = 0;
          for (const gKey of sortedKeys) {
            if (groupMeta.get(gKey).label === code) cnt += grouped.get(gKey).length;
          }
          drawTextTD(opPage, `${cnt} Kayıt ->`, 472.0, oy + 13.0, 7.9, fBold, [0.05, 0.38, 0.72], PDFLib);
          addInternalLinkTD(out, opPage, rRect, tgtPage, tgtY);
        } else {
          drawTextTD(opPage, "-", 472.0, oy + 13.0, 8.0, fReg, [0.55, 0.55, 0.55], PDFLib);
        }

        insertHiddenSearchLayer(
          opPage,
          fHelv,
          { x0: 52.0, y0: oy + 1.0, x1: 542.0, y1: oy + ROW_H - 1.0 },
          `${buildAptShortcuts(code).join(" ")} ${toAsciiLower(name)}`,
          PDFLib
        );
        oy += ROW_H;
      }
    }

    // Add Top Nav Bar & Footer
    const allPages = out.getPages();
    const totalPages = allPages.length;
    for (let pI = 0; pI < totalPages; pI++) {
      const p = allPages[pI];
      if (pI >= 1) {
        const navItems = [
          [{ x0: 51.0, y0: 16.0, x1: 185.0, y1: 36.0 }, "Hızlı Fihrist (S.1)", allPages[0]],
          [{ x0: 193.0, y0: 16.0, x1: 345.0, y1: 36.0 }, `Oturum Listesi (S.${oturumFirstPNum})`, oturumPages[0]],
          [{ x0: 353.0, y0: 16.0, x1: 495.0, y1: 36.0 }, `Plaka Dizini (S.${plateDirStartPNum})`, plateDirStartPage],
        ];
        for (const [nrect, nlbl, tgtP] of navItems) {
          drawRectTD(p, nrect, { fill: [0.94, 0.96, 0.99], border: [0.75, 0.8, 0.88], borderWidth: 0.5 }, PDFLib);
          drawTextTD(p, nlbl, nrect.x0 + 10.0, 29.0, 7.9, fBold, [0.12, 0.31, 0.55], PDFLib);
          addInternalLinkTD(out, p, nrect, tgtP, 15.0);
        }
        drawTextTD(p, `S. ${pI + 1}/${totalPages}`, 504.0, 29.0, 7.9, fBold, [0.4, 0.45, 0.52], PDFLib);
      }
      drawTextTD(p, `Sayfa ${pI + 1} / ${totalPages}`, 272.0, 818.0, 8.2, fReg, [0.45, 0.45, 0.45], PDFLib);
    }

    // Build TOC Bookmarks
    const toc = [
      { level: 1, title: "Hızlı Daire Fihristi (Ana Sayfa)", page: allPages[0], yTD: 0 },
      { level: 1, title: "Koru Oturum Listesi (Blok 1–7 & 16)", page: oturumPages[0], yTD: 0 },
    ];
    const blkAdded = new Set();
    for (const key of sortedKeys) {
      const meta = groupMeta.get(key);
      const lbl = meta.label;
      const blk = meta.sortKey[0];
      const [tgtPage, tgtY] = groupTargets.get(lbl);
      if (TARGET_BLOCKS.has(blk)) {
        if (!blkAdded.has(blk)) {
          blkAdded.add(blk);
          toc.push({ level: 1, title: `Blok ${blk}`, page: tgtPage, yTD: tgtY });
        }
        const ownS = meta.owner ? ` - ${truncText(meta.owner, 24)}` : "";
        toc.push({ level: 2, title: `${lbl} (${meta.count})${ownS}`, page: tgtPage, yTD: tgtY });
      } else {
        if (!blkAdded.has(90)) {
          blkAdded.add(90);
          toc.push({ level: 1, title: "Çoklu Daire & Genel Bildirimler", page: tgtPage, yTD: tgtY });
        }
        toc.push({ level: 2, title: `${lbl} (${meta.count})`, page: tgtPage, yTD: tgtY });
      }
    }
    toc.push({ level: 1, title: `Hızlı Plaka Arama Dizini (${sortedPlates.length} Plaka)`, page: plateDirStartPage, yTD: 0 });
    setPdfOutlines(out, toc, PDFLib);

    return {
      bytes: await out.save({ useObjectStreams: false }),
      pageMeta: extractPageInteractiveMeta(allPages),
    };
  }

  // ---------------- MAIN ENTRY POINT ----------------

  function extractDocumentDate(metaInfo, srcFilename) {
    const cd = metaInfo && metaInfo.CreationDate ? String(metaInfo.CreationDate) : "";
    const m = /D:(\d{4})(\d{2})(\d{2})/.exec(cd);
    if (m) {
      return {
        badge: `${m[3]}.${m[2]}.${m[1]}`,
        fileTag: `${m[3]}_${m[2]}_${m[1]}`,
      };
    }
    const fm = /(\d{2})[._-](\d{2})[._-](\d{4})/.exec(srcFilename || "");
    if (fm) {
      return {
        badge: `${fm[1]}.${fm[2]}.${fm[3]}`,
        fileTag: `${fm[1]}_${fm[2]}_${fm[3]}`,
      };
    }
    const now = new Date();
    const dd = String(now.getDate()).padStart(2, "0");
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const yyyy = String(now.getFullYear());
    return { badge: `${dd}.${mm}.${yyyy}`, fileTag: `${dd}_${mm}_${yyyy}` };
  }

  async function convertSchedulePdf(pdfArrayBuffer, deps, onProgress, srcFilename) {
    const progress = (pct, msg) => {
      if (typeof onProgress === "function") onProgress(pct, msg);
    };

    progress(4, "PDF açılıyor...");
    const srcCopyForLib = pdfArrayBuffer.slice(0);
    const { pdfjsLib } = deps;
    const loadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(pdfArrayBuffer),
      verbosity: 0,
      useWorkerFetch: false,
    });
    const jsDoc = await loadingTask.promise;
    const numPages = jsDoc.numPages;

    let metaInfo = {};
    try {
      const md = await jsDoc.getMetadata();
      metaInfo = (md && md.info) || {};
    } catch (_) {}
    const { badge: dateBadge, fileTag } = extractDocumentDate(metaInfo, srcFilename);

    const pagesMeta = [];
    for (let p = 1; p <= numPages; p++) {
      if (p === 1 || p % 5 === 0 || p === numPages) {
        progress(5 + Math.round((p / numPages) * 40), `Sayfa okunuyor (${p}/${numPages})...`);
      }
      const page = await jsDoc.getPage(p);
      const vp = page.getViewport({ scale: 1.0 });
      const { words, lines } = await extractPageWordsAndLines(page, vp.height);
      const { grayBars, fillDraws } = await extractPageGraphics(page, pdfjsLib, vp.height);
      pagesMeta.push({
        pIdx: p - 1,
        width: vp.width,
        height: vp.height,
        words,
        lines,
        grayBars,
        fillDraws,
      });
      if (typeof page.cleanup === "function") page.cleanup();
    }
    try { await jsDoc.destroy(); } catch (_) {}

    progress(48, "Bölümler ve listeler çözümleniyor...");
    const secInfo = detectSections(pagesMeta);

    const firmsMap = extractParsel4Firms(pagesMeta, secInfo);
    const p13Sections = extractPages13Sections(pagesMeta, secInfo);
    const totalEmployees = Array.from(firmsMap.values()).reduce((acc, arr) => acc + arr.length, 0);

    const oturumAll = extractOturumListesi(pagesMeta, secInfo);
    const oturumFiltered = [];
    const ownerMap = new Map();
    const nameCountsAll = new Map();
    const nameToCodeAll = new Map();

    for (const [name, bStr, dStr] of oturumAll) {
      if (/^\d+$/.test(bStr) && /^\d+$/.test(dStr)) {
        const b = parseInt(bStr, 10);
        const d = parseInt(dStr, 10);
        const normN = toAsciiLower(name).replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
        if (normN) {
          nameCountsAll.set(normN, (nameCountsAll.get(normN) || 0) + 1);
          nameToCodeAll.set(normN, [b, d]);
        }
        if (TARGET_BLOCKS.has(b)) {
          oturumFiltered.push([name, b, d]);
          ownerMap.set(`B${b}/D${d}`, name);
        }
      }
    }
    const uniqueOwnerToCode = new Map();
    for (const [normN, cnt] of nameCountsAll.entries()) {
      if (cnt === 1) uniqueOwnerToCode.set(normN, nameToCodeAll.get(normN));
    }

    const records = extractMailRecords(pagesMeta, secInfo);
    const grouped = new Map();
    const keySortObj = new Map();

    for (let recIdx = 0; recIdx < records.length; recIdx++) {
      const parts = records[recIdx];
      const [label, sk] = classifyRecord(parts, uniqueOwnerToCode);
      if (TARGET_BLOCKS.has(sk[0]) || ALLOWED_MULTI_LABELS.has(label)) {
        const key = `${String(sk[0]).padStart(3, "0")}_${String(sk[1]).padStart(3, "0")}_${String(sk[2]).padStart(3, "0")}_${label}`;
        if (!grouped.has(key)) {
          grouped.set(key, []);
          keySortObj.set(key, sk);
        }
        grouped.get(key).push({ recIdx, parts });
      }
    }

    const sortedKeys = Array.from(grouped.keys()).sort((ka, kb) => {
      const sa = keySortObj.get(ka);
      const sb = keySortObj.get(kb);
      if (sa[0] !== sb[0]) return sa[0] - sb[0];
      if (sa[1] !== sb[1]) return sa[1] - sb[1];
      if (sa[2] !== sb[2]) return sa[2] - sb[2];
      return ka.localeCompare(kb);
    });

    const groupMeta = new Map();
    const dedupPlates = new Map();
    for (const key of sortedKeys) {
      const label = key.split("_").slice(3).join("_");
      const items = grouped.get(key);
      let owner = ownerMap.get(label) || "";
      if (!owner) {
        if (label === "B2/D6") owner = "Magiarte Mimarlık (Blok 2/6)";
        else if (label === "B16/D11") owner = "Arif Bayraktar";
        else if (label === "Genel / Blok Belirtilmemiş") owner = "Site Geneli / Blok Belirtilmemiş";
        else {
          const c2Names = [];
          const badC2 = ["whatsapp", "üzerinden geldi", "kasım", "uygundur", "bilgilendirme", "yardımcı"];
          for (const it of items) {
            for (const p of it.parts) {
              const c2s = (p.c2 || "").replace(/\s+/g, " ").trim();
              if (c2s && !c2Names.includes(c2s) && !badC2.some((bk) => c2s.toLowerCase().includes(bk))) {
                c2Names.push(c2s);
              }
            }
          }
          owner = c2Names.slice(0, 2).join(" / ");
        }
      }

      const grpPlates = [];
      const seenP = new Set();
      for (const it of items) {
        const rawTxt = it.parts.map((p) => `${p.c0}\n${p.c1}`).join("\n");
        for (const [sp, cp] of extractPlates(rawTxt)) {
          if (!seenP.has(cp)) {
            seenP.add(cp);
            grpPlates.push([sp, cp]);
          }
          dedupPlates.set(`${cp}__${label}`, [sp, cp, label, owner]);
        }
      }

      groupMeta.set(key, {
        label,
        owner,
        plates: grpPlates,
        shortcuts: buildAptShortcuts(label),
        count: items.length,
        sortKey: keySortObj.get(key),
      });
    }

    const sortedPlates = Array.from(dedupPlates.values()).sort((a, b) => {
      if (a[1] !== b[1]) return a[1] < b[1] ? -1 : 1;
      return a[2] < b[2] ? -1 : (a[2] > b[2] ? 1 : 0);
    });

    progress(56, "Firmalar ve Çalışanlar PDF'i hazırlanıyor...");
    const firmsOut = await buildFirmsPdf(firmsMap, p13Sections, dateBadge, deps);

    progress(68, "Blok 1–7 & 16 Mobil Rehber PDF'i hazırlanıyor...");
    const blokOut = await buildMobileBlokPdf(
      srcCopyForLib, numPages, oturumFiltered, grouped, groupMeta, sortedPlates, sortedKeys, dateBadge, deps, progress
    );

    progress(96, "Son kontroller yapılıyor...");
    const totalNotifs = sortedKeys.reduce((acc, k) => acc + grouped.get(k).length, 0);

    const employeeNames = [];
    for (const [fName, emps] of firmsMap.entries()) {
      for (const e of emps) employeeNames.push(`${fName}:${e.name}`);
    }
    employeeNames.sort();

    const stats = {
      sourcePages: numPages,
      dateBadge,
      fileTag,
      firmCount: firmsMap.size,
      employeeCount: totalEmployees,
      aksoyCount: (firmsMap.get("AKSOY") || []).length,
      oturumTotal: oturumAll.length,
      oturumFiltered: oturumFiltered.length,
      mergedMailTotal: records.length,
      blokGroupCount: sortedKeys.length,
      blokNotifCount: totalNotifs,
      plateCount: sortedPlates.length,
      employeeNames,
      groupCounts: sortedKeys.map((k) => {
        const m = groupMeta.get(k);
        return `${m.label}:${m.count}`;
      }),
    };

    progress(100, "Hazır!");
    return {
      firmsPdfBytes: firmsOut.bytes,
      blokPdfBytes: blokOut.bytes,
      firmsPageMeta: firmsOut.pageMeta,
      blokPageMeta: blokOut.pageMeta,
      firmsFilename: `Parsel4_Firmalar_ve_Calisanlar_Mobil_${fileTag}.pdf`,
      blokFilename: `Blok_1-7_ve_16_Mobil_Rehber_${fileTag}.pdf`,
      stats,
    };
  }

  return {
    convertSchedulePdf,
    toAsciiLower,
    extractPlates,
  };
});
