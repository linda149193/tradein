// 在瀏覽器內解析兩份 PDF，輸出和 data.json 相同格式的資料。
(function () {
  var BRANDS = '(APPLE|SAMSUNG|OPPO|VIVO|紅米REDMI|REALME|小米XIAOMI|POCO|GOOGLE|ASUS|MOTOROLA|SONY|HTC)';
  var RE_BASE = new RegExp('^\\s*(\\d+)\\s+' + BRANDS + '\\s+(.+?)\\s+([\\d,]+)\\s*$');
  var RE_BONUS = new RegExp('^\\s*' + BRANDS + '\\s+(.+?)\\s+((?:[\\d,]+\\s+){3}[\\d,]+(?:\\s+[\\d,]+)?)\\s*$');
  var RE_BRAND_START = new RegExp('^\\s*' + BRANDS + '\\s');
  var num = function (s) { return parseInt(s.replace(/,/g, ''), 10); };

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
    lines.forEach(function (l) {
      l.items.sort(function (a, b) { return a.x - b.x; });
      var t = '', prev = null;
      l.items.forEach(function (it) {
        if (prev && it.x - (prev.x + prev.w) > 1.5) t += ' ';
        t += it.s.trim() === it.s ? it.s : it.s.replace(/^\s+/, ' ').replace(/\s+$/, ' ');
        prev = it;
      });
      l.text = t.replace(/\s+/g, ' ');
    });
    return lines;
  }
  var mmdd = function (a, b, c, d) { return a + '/' + b + '–' + c + '/' + d; };
  function period(s) {
    var m = /\((\d{2})(\d{2})-(\d{2})(\d{2})\)/.exec(s);
    return m ? mmdd(m[1], m[2], m[3], m[4]) : '';
  }

  function parseBase(pages) {
    var base = {}, bad = [], head = '';
    pages.forEach(function (lines, pi) {
      lines.forEach(function (l) {
        if (pi === 0 && !head && /\d{4}_\d{4}-\d{4}/.test(l.text)) head = l.text;
        var m = RE_BASE.exec(l.text);
        if (m) base[m[2] + '\u0001' + m[3].trim()] = num(m[4]);
        else if (/^\s*\d+\s/.test(l.text)) bad.push(l.text);
      });
    });
    var hm = /(\d{4})_(\d{2})(\d{2})-(\d{2})(\d{2})/.exec(head);
    return { base: base, bad: bad, updated: hm ? hm[1] + '-' + hm[2] : '', period: hm ? mmdd(hm[2], hm[3], hm[4], hm[5]) : '' };
  }

  function parseBonus(pages) {
    var bonus = {}, bad = [], cols = null;
    var first = pages[0] || [];
    // 用第一個資料列的 5 個數字位置，把表頭切成 5 欄
    var fi = first.findIndex(function (l) { return RE_BONUS.test(l.text); });
    if (fi > 0) {
      var nums = first[fi].items.filter(function (i) { return /^[\d,]+$/.test(i.s.trim()); });
      if (nums.length >= 4) {
        var xs = nums.slice(-5).map(function (i) { return i.x + i.w / 2; });
        var bounds = xs.map(function (x, k) { return k === 0 ? -1e9 : (xs[k - 1] + x) / 2; });
        bounds.push(1e9);
        var head = first.slice(0, fi);
        cols = xs.map(function (_, k) {
          var lines = [];
          head.forEach(function (l) {
            var its = l.items.filter(function (i) { var c = i.x + i.w / 2; return c >= bounds[k] && c < bounds[k + 1]; });
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
    pages.forEach(function (lines) {
      lines.forEach(function (l) {
        var m = RE_BONUS.exec(l.text);
        if (m) {
          var v = m[3].split(/\s+/).map(num);
          while (v.length < 5) v.push(null);
          bonus[m[1] + '\u0001' + m[2].trim()] = v;
        } else if (RE_BRAND_START.test(l.text)) bad.push(l.text);
      });
    });
    return { bonus: bonus, bad: bad, cols: cols };
  }

  // 回傳 {data, report}
  function build(basePages, bonusPages, fallbackCols) {
    var b = parseBase(basePages), x = parseBonus(bonusPages);
    var keys = Object.keys(b.base);
    var onlyBase = keys.filter(function (k) { return !(k in x.bonus); }).length;
    var onlyBonus = Object.keys(x.bonus).filter(function (k) { return !(k in b.base); }).length;
    var cols = x.cols && x.cols.length === 5 && x.cols.every(function (c) { return c.name; }) ? x.cols : fallbackCols;
    var colsOk = cols === x.cols;
    var rows = keys.map(function (k) {
      var p = k.split('\u0001');
      return { b: p[0], m: p[1], p: b.base[k], x: x.bonus[k] || null };
    });
    var basePeriod = b.period || (cols && cols[0] && cols[0].period) || '';
    return {
      data: { meta: { updated: b.updated, basePeriod: basePeriod, columns: cols }, rows: rows },
      report: { rows: rows.length, bad: b.bad.length + x.bad.length, onlyBase: onlyBase, onlyBonus: onlyBonus, colsOk: colsOk, badSamples: b.bad.concat(x.bad).slice(0, 3) }
    };
  }

  function readFile(file) { return file.arrayBuffer(); }
  window.TradeInParse = { readPdf: readPdf, build: build, readFile: readFile };
})();
