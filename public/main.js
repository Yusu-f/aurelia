/* AURELIA — scroll-scrub engine */
(function () {
  'use strict';

  var FRAME_VER = '1';
  var DPR_CAP = 2;

  /* per-handler rAF throttle — each scroll consumer gets its OWN gate.
     rAF is fully paused in hidden/occluded tabs, so a timeout fallback
     keeps handlers ticking there (and in energy-saver edge cases). */
  function rafThrottle(fn) {
    var queued = false;
    return function () {
      if (queued) return;
      queued = true;
      var timer;
      var raf = requestAnimationFrame(function () {
        clearTimeout(timer);
        queued = false;
        fn();
      });
      timer = setTimeout(function () {
        cancelAnimationFrame(raf);
        queued = false;
        fn();
      }, 120);
    };
  }

  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

  /* debug hook for headless verification */
  window.__scrub = {};

  /* ---------- frame scrubber ---------- */
  function Scrubber(section, name, count) {
    this.section = section;
    this.name = name;
    this.count = count;
    this.canvas = section.querySelector('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.frames = new Array(count);
    this.loadedUpTo = -1;
    this.current = -1;
    this.loading = false;
    this.callouts = Array.prototype.slice.call(section.querySelectorAll('.callout'));
    this.resize();
    var self = this;
    window.addEventListener('resize', rafThrottle(function () {
      self.resize();
      self.draw(self.current < 0 ? 0 : self.current, true);
    }));
    this.onScroll = rafThrottle(function () { self.update(); });
    window.addEventListener('scroll', this.onScroll, { passive: true });
  }

  Scrubber.prototype.src = function (i) {
    var n = String(i + 1);
    while (n.length < 4) n = '0' + n;
    return 'frames/' + this.name + '/f_' + n + '.jpg?v=' + FRAME_VER;
  };

  Scrubber.prototype.load = function () {
    if (this.loading) return;
    this.loading = true;
    var self = this;
    var inflight = 0, next = 0, MAX = 6;
    function pump() {
      while (inflight < MAX && next < self.count) {
        (function (i) {
          var img = new Image();
          inflight++;
          img.onload = img.onerror = function () {
            inflight--;
            self.frames[i] = img;
            while (self.loadedUpTo + 1 < self.count && self.frames[self.loadedUpTo + 1]) self.loadedUpTo++;
            if (i === 0 && self.current < 0) self.draw(0, true);
            pump();
          };
          img.src = self.src(i);
        })(next++);
      }
    }
    pump();
  };

  Scrubber.prototype.resize = function () {
    var dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
    this.canvas.width = this.canvas.clientWidth * dpr;
    this.canvas.height = this.canvas.clientHeight * dpr;
  };

  Scrubber.prototype.draw = function (idx, force) {
    /* draw nearest loaded frame at or below idx */
    var i = Math.min(idx, this.loadedUpTo);
    if (i < 0) return;
    if (!force && i === this.current) return;
    this.current = i;
    var img = this.frames[i];
    var cw = this.canvas.width, ch = this.canvas.height;
    var s = Math.max(cw / img.naturalWidth, ch / img.naturalHeight);
    var w = img.naturalWidth * s, h = img.naturalHeight * s;
    this.ctx.drawImage(img, (cw - w) / 2, (ch - h) / 2, w, h);
  };

  Scrubber.prototype.update = function () {
    var rect = this.section.getBoundingClientRect();
    var vh = window.innerHeight;
    /* proximity-load fallback: IntersectionObserver also stalls in hidden
       tabs, so kick off loading from the scroll path when close enough */
    if (!this.loading && rect.top < vh * 1.5 && rect.bottom > -vh * 0.5) this.load();
    var total = rect.height - vh;
    var p = clamp01(-rect.top / total);
    window.__scrub[this.name] = p;
    var idx = Math.min(this.count - 1, Math.floor(p * this.count));
    this.draw(idx, false);
    for (var c = 0; c < this.callouts.length; c++) {
      var el = this.callouts[c];
      var from = parseFloat(el.getAttribute('data-at'));
      var until = parseFloat(el.getAttribute('data-until') || '2');
      el.classList.toggle('on', p >= from && p <= until);
    }
  };

  /* ---------- boot scrubbers, lazy-load by proximity ---------- */
  var scrubbers = [];
  var sections = document.querySelectorAll('.scrub[data-frames]');
  fetch('frames/manifest.json?v=' + FRAME_VER)
    .then(function (r) { return r.json(); })
    .then(function (manifest) {
      Array.prototype.forEach.call(sections, function (sec) {
        var name = sec.getAttribute('data-frames');
        var s = new Scrubber(sec, name, manifest[name].count);
        scrubbers.push(s);
        s.update();
      });
      /* hero loads immediately; others when within 1.5 viewports */
      if (scrubbers[0]) scrubbers[0].load();
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (!e.isIntersecting) return;
          scrubbers.forEach(function (s) {
            if (s.section === e.target) { s.load(); io.unobserve(e.target); }
          });
        });
      }, { rootMargin: '150% 0px' });
      scrubbers.slice(1).forEach(function (s) { io.observe(s.section); });
    });

  /* ---------- nav solid state (own throttle gate) ---------- */
  var nav = document.querySelector('.nav');
  var onNav = rafThrottle(function () {
    nav.classList.toggle('solid', window.scrollY > window.innerHeight * 0.5);
  });
  window.addEventListener('scroll', onNav, { passive: true });
  onNav();

  /* ---------- hero overlay fade (own throttle gate) ---------- */
  var heroSec = document.getElementById('hero');
  var heroOverlay = heroSec.querySelector('.hero-overlay');
  var cue = heroSec.querySelector('.scroll-cue');
  var onHeroFade = rafThrottle(function () {
    var p = window.__scrub.hero || 0;
    heroOverlay.style.opacity = String(clamp01(1 - p * 2.2));
    heroOverlay.style.transform = 'translateY(' + (-p * 60) + 'px)';
    if (cue) cue.style.opacity = String(clamp01(1 - p * 8));
  });
  window.addEventListener('scroll', onHeroFade, { passive: true });

  /* ---------- reveal-on-scroll ---------- */
  var revealIO = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) { e.target.classList.add('on'); revealIO.unobserve(e.target); }
    });
  }, { threshold: 0.18 });
  Array.prototype.forEach.call(document.querySelectorAll('.reveal'), function (el) { revealIO.observe(el); });

  /* ---------- animated stat counters ---------- */
  function animateNum(el) {
    var target = parseFloat(el.getAttribute('data-count'));
    var t0 = null;
    function step(t) {
      if (!t0) t0 = t;
      var k = clamp01((t - t0) / 1400);
      var eased = 1 - Math.pow(1 - k, 3);
      el.firstChild.nodeValue = String(Math.round(target * eased));
      if (k < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }
  var statIO = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) { animateNum(e.target); statIO.unobserve(e.target); }
    });
  }, { threshold: 0.6 });
  Array.prototype.forEach.call(document.querySelectorAll('[data-count]'), function (el) { statIO.observe(el); });

  /* ---------- booking ---------- */
  var PRICE = 185000;
  var seatsEl = document.getElementById('seats');
  var totalEl = document.getElementById('total');
  var form = document.getElementById('book-form');
  var manifestEl = document.getElementById('manifest');

  function money(n) { return '$' + n.toLocaleString('en-US'); }
  function updateTotal() { totalEl.textContent = money(PRICE * parseInt(seatsEl.value, 10)); }
  seatsEl.addEventListener('change', updateTotal);
  updateTotal();

  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var name = document.getElementById('pax-name').value.trim() || 'Guest';
    var seats = parseInt(seatsEl.value, 10);
    var windowSel = document.getElementById('window');
    var flight = windowSel.options[windowSel.selectedIndex].text;
    document.getElementById('m-name').textContent = name;
    document.getElementById('m-flight').textContent = flight;
    document.getElementById('m-seats').textContent = String(seats);
    document.getElementById('m-total').textContent = money(PRICE * seats);
    document.getElementById('m-ref').textContent = 'AUR-' + Math.random().toString(36).slice(2, 8).toUpperCase();
    form.style.display = 'none';
    manifestEl.classList.add('on');
  });
})();
