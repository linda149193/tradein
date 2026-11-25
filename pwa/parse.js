// 在瀏覽器內解析兩份 PDF，輸出和 data.json 相同格式的資料。
// 加碼欄位數量不固定：由 PDF 內容自動判斷，用數字位置對應欄位（空白格會填 null）。
(function () {
  var BRANDS = '(APPLE|SAMSUNG|OPPO|VIVO|紅米REDMI|REALME|小米XIAOMI|POCO|GOOGLE|ASUS|MOTOROLA|SONY|HTC)';
  var RE_BASE = new RegExp('^\\s*(\\d+)\\s+' + BRANDS + '\\s+(.+?)\\s+([\\d,]+)\\s*$');
  var RE_BONUS = new RegExp('^\\s*' + BRANDS + '\\s+(.+?)\\s+((?:[\\d,]+\\s+){0,7}[\\d,]+)\\s*$');
  var RE_BRAND_START = new RegExp('^\\s*' + BRANDS + '\\s');
  var RE_HEAD = /^(?:(\d{4})_)?(\d{2})(\d{2})-(\d{2})(\d{2})$/;
  var num = function (s) { return parseInt(s.replace(/,/g, ''), 10); };
  var isAmt = function (i) { return /^[\d,]+$/.test(i.s.trim()); };
  var center = function (i) { return i.x + i.w / 2; };

  // 讀 PDF，回傳每頁的「行」：[{y, items:[{x,w,s}], text}]，y 由上到下
  function readPdf(buf) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
    return pdfjsLib.getDocument({ data: buf }).promise.then(function (pdf) {
      var pages = [];
      var chain = Promise.resolve();
      for (var n = 1; n <= pdf.numPages; n++) (function (n) {
        chain = chain.then(function () { return pdf.getPage(n); })
          .then(function (p) { return p.getTextContent(); })
          .then(function (tc) { pages.push(toLines(tc.items)); });
      })(n);
      return chain.then(function () { return pages; });
    });
  }
  function toLines(items) {
    var its = items.filter(function (i) { return i.str && i.str.trim(); })
      .map(function (i) { return { x: i.transform[4], y: i.transform[5], w: i.width, s: i.str }; });
    its.sort(function (a, b) { return b.y - a.y || a.x - b.x; });
    var lines = [];
    its.forEach(function (it) {
      var l = lines[lines.length - 1];
      if (l && Math.abs(l.y - it.y) < 3) l.items.push(it);
      else lines.push({ y: it.y, items: [it] });
    });
    lines.forEach(finishLine);
    return lines;
  }
  function finishLine(l) {
    l.items.sort(function (a, b) { return a.x - b.x; });
    var t = '', prev = null;
    l.items.forEach(function (it) {
      // 機型名稱很長時會貼到價格欄，數字欄前一律補空白
      if (prev && (it.x - (prev.x + prev.w) > 1.5 || (isAmt(it) && !isAmt(prev)))) t += ' ';
      t += it.s.trim() === it.s ? it.s : it.s.replace(/^\s+/, ' ').replace(/\s+$/, ' ');
      prev = it;
    });
    l.text = t.replace(/\s+/g, ' ');
    return l;
  }
  // 機型名稱太長時，一列資料會斷成上下兩行：把它們合併回同一列
  function mergeWrapped(lines, mode) {
    var out = [];
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i], nx = lines[i + 1], t = l.text;
      var wrapped = nx && (mode === 'base'
        ? (/^\d+\s+/.test(t) && RE_BRAND_START.test(t.replace(/^\d+\s+/, '')) && !RE_BASE.test(t) && /^[\d,]+$/.test(nx.text))
        : (/^\S+\s+[\d,\s]+$/.test(t) && RE_BRAND_START.test(t + ' ') && !RE_BRAND_START.test(nx.text) && /\d/.test(nx.text)));
      if (wrapped) { out.push(finishLine({ y: l.y, items: l.items.concat(nx.items) })); i++; }
      else out.push(l);
    }
    return out;
  }
  var mmdd = function (a, b, c, d) { return a + '/' + b + '–' + c + '/' + d; };
  function period(s) {
    var m = /\((\d{2})(\d{2})-(\d{2})(\d{2})\)/.exec(s);
    return m ? mmdd(m[1], m[2], m[3], m[4]) : '';
  }
  // 檔頭沒有年份時：在「去年、今年、明年」之中，挑最接近今天的那一年
  function nearestYear(mm, dd) {
    var now = new Date(), best = now.getFullYear(), bd = 1e18;
    [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1].forEach(function (y) {
      var diff = Math.abs(new Date(y, +mm - 1, +dd) - now);
      if (diff < bd) { bd = diff; best = y; }
    });
    return best;
  }

  function parseBase(pages) {
    var base = {}, bad = [], head = null;
    pages.forEach(function (lines, pi) {
      mergeWrapped(lines, 'base').forEach(function (l) {
        if (pi === 0 && !head) { var h = RE_HEAD.exec(l.text.trim()); if (h) head = h; }
        var m = RE_BASE.exec(l.text);
        if (m) base[m[2] + '\u0001' + m[3].trim()] = num(m[4]);
        else if (/^\s*\d+\s/.test(l.text)) bad.push(l.text);
      });
    });
    var updated = '', per = '';
    if (head) {
      var y = head[1] || nearestYear(head[2], head[3]);
      updated = y + '-' + head[2] + '-' + head[3];   // 期間開始日，當作資料版本
      per = mmdd(head[2], head[3], head[4], head[5]);
    }
    return { base: base, bad: bad, updated: updated, period: per };
  }

  function parseBonus(pages) {
    var bonus = {}, bad = [], cols = null, N = 0;
    pages = pages.map(function (lines) { return mergeWrapped(lines, 'bonus'); });
    // 1. 先統計每列有幾個數字，取最常見的數量當作欄位數
    var counts = {};
    pages.forEach(function (lines) {
      lines.forEach(function (l) {
        var m = RE_BONUS.exec(l.text);
        if (m) { var c = m[3].split(/\s+/).length; counts[c] = (counts[c] || 0) + 1; }
      });
    });
    Object.keys(counts).forEach(function (k) { if (!N || counts[k] > counts[N]) N = +k; });
    // 2. 用第一頁第一個完整列的數字位置，把表頭切成 N 欄
    var first = pages[0] || [], bounds = null, left = -1e9;
    var fi = first.findIndex(function (l) {
      var m = RE_BONUS.exec(l.text);
      return m && m[3].split(/\s+/).length === N;
    });
    if (fi >= 0 && N > 0) {
      var nums = first[fi].items.filter(isAmt);
      var xs = nums.slice(-N).map(center);
      if (xs.length === N) {
        var gap = N > 1 ? xs[1] - xs[0] : 80;
        left = xs[0] - gap / 2;
        bounds = xs.map(function (x, k) { return k === 0 ? -1e9 : (xs[k - 1] + x) / 2; });
        bounds.push(1e9);
        var head = first.slice(0, fi);
        cols = xs.map(function (_, k) {
          var lines = [];
          head.forEach(function (l) {
            var its = l.items.filter(function (i) { var c = center(i); return c >= bounds[k] && c < bounds[k + 1]; });
            if (its.length) lines.push(its.map(function (i) { return i.s.trim(); }).join(' '));
          });
          var per = '', names = [];
          lines.forEach(function (t) {
            var p = period(t); if (p) per = p;
            t = t.replace(/\(\d{4}-\d{4}\)/g, '').replace(/小米加碼金|廠牌|機型/g, '').trim();
            if (!t) return;
            var prev = names[names.length - 1];
            if (prev && !/\/$/.test(prev) && /^(REDMI|XIAOMI|POCO)\b/i.test(t) && !/^by\b/i.test(t)) names.push(t);
            else if (prev) names[names.length - 1] = prev + ' ' + t;
            else names.push(t);
          });
          var name = names.join(' / ').replace(/\s*powered by Xiaomi/i, '').replace(/Leica\s+/i, '').replace(/\s\/\s(REDMI|XIAOMI|POCO)\s+/i, ' / ');
          return { name: name, period: per };
        });
      }
    }
    // 3. 逐列解析；有欄位位置時，依數字位置放進對應欄（空白格為 null）
    pages.forEach(function (lines) {
      lines.forEach(function (l) {
        var m = RE_BONUS.exec(l.text);
        if (m) {
          var v;
          if (bounds) {
            v = []; for (var k = 0; k < N; k++) v.push(null);
            var dup = false;
            l.items.filter(isAmt).forEach(function (i) {
              var c = center(i); if (c < left) return;
              for (var k = 0; k < N; k++) if (c >= bounds[k] && c < bounds[k + 1]) { if (v[k] !== null) dup = true; v[k] = num(i.s.trim()); }
            });
            if (dup) bad.push(l.text);
          } else {
            v = m[3].split(/\s+/).map(num);
            while (v.length < N) v.push(null);
          }
          bonus[m[1] + '\u0001' + m[2].trim()] = v;
        } else if (RE_BRAND_START.test(l.text)) bad.push(l.text);
      });
    });
    return { bonus: bonus, bad: bad, cols: cols, n: N };
  }

  // 回傳 {data, report}
  function build(basePages, bonusPages, fallbackCols) {
    var b = parseBase(basePages), x = parseBonus(bonusPages);
    var keys = Object.keys(b.base);
    var onlyBase = keys.filter(function (k) { return !(k in x.bonus); }).length;
    var onlyBonus = Object.keys(x.bonus).filter(function (k) { return !(k in b.base); }).length;
    var headOk = x.cols && x.cols.length === x.n && x.cols.every(function (c) { return c.name; });
    var cols = headOk ? x.cols
      : (fallbackCols && fallbackCols.length === x.n ? fallbackCols
        : Array.apply(null, Array(x.n)).map(function (_, i) { return { name: '新機 ' + (i + 1), period: '' }; }));
    var rows = keys.map(function (k) {
      var p = k.split('\u0001');
      return { b: p[0], m: p[1], p: b.base[k], x: x.bonus[k] || null };
    });
    var basePeriod = b.period || (cols[0] && cols[0].period) || '';
    return {
      data: { meta: { updated: b.updated, basePeriod: basePeriod, columns: cols }, rows: rows },
      report: { rows: rows.length, bad: b.bad.length + x.bad.length, onlyBase: onlyBase, onlyBonus: onlyBonus, colsOk: !!headOk, n: x.n, badSamples: b.bad.concat(x.bad).slice(0, 3) }
    };
  }

  // 這份 PDF 的生效起始日（讀不到回傳 null）
  function startOf(pages, kind) {
    if (kind === 'base') {
      var b = parseBase(pages); if (!b.updated) return null;
      var p = b.updated.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]);
    }
    var x = parseBonus(pages); if (!x.cols) return null;
    var best = null;
    x.cols.forEach(function (c) {
      var m = /^(\d{2})\/(\d{2})/.exec(c.period || '');
      if (m) { var d = new Date(nearestYear(m[1], m[2]), +m[1] - 1, +m[2]); if (!best || d < best) best = d; }
    });
    return best;
  }

  function readFile(file) { return file.arrayBuffer(); }
  window.TradeInParse = { readPdf: readPdf, build: build, readFile: readFile, startOf: startOf };
})();
