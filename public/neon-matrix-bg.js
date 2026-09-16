/* ============================================================
   NEON MATRIX BACKGROUND  v1.0
   Nen "mua ky tu" cho Neon Terminal UI Kit.
   Nguon: folder "toàn bộ giao diện ui" (template mau cua user)
   Cach dung:
     <canvas id="nt-matrix"></canvas>
     <script src="neon-matrix-bg.js"></script>
   Tuy chinh:
     NeonMatrix.start({ color:'#00ff9c', fontSize:16, speed:1, opacity:.5 })
   ============================================================ */
(function (global) {
  const DEFAULT_CHARS =
    "アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワン0123456789";

  function start(opts) {
    const o = Object.assign(
      {
        canvas: "#nt-matrix",
        chars: DEFAULT_CHARS,
        color: "#00ff9c",
        fontSize: 16,
        speed: 1,        // 1 = ~20 khung/giay
        fade: 0.06,      // do mo dan cua vet chu
        opacity: 0.5
      },
      opts || {}
    );

    const cv =
      typeof o.canvas === "string" ? document.querySelector(o.canvas) : o.canvas;
    if (!cv) return null;
    const ctx = cv.getContext("2d");
    cv.style.opacity = o.opacity;

    let cols = 0;
    let drops = [];
    let dpr = 1;

    function resize() {
      dpr = Math.min(global.devicePixelRatio || 1, 2);
      cv.width = Math.floor(cv.clientWidth * dpr);
      cv.height = Math.floor(cv.clientHeight * dpr);
      cols = Math.ceil(cv.width / (o.fontSize * dpr));
      drops = new Array(cols)
        .fill(0)
        .map(() => Math.random() * (cv.height / (o.fontSize * dpr)));
      ctx.font = o.fontSize * dpr + "px " + "monospace";
    }

    function frame() {
      // Lop den mo dan tao vet duoi cho ky tu
      ctx.fillStyle = "rgba(2, 4, 10, " + o.fade + ")";
      ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.fillStyle = o.color;
      const step = o.fontSize * dpr;
      for (let i = 0; i < cols; i++) {
        const ch = o.chars[(Math.random() * o.chars.length) | 0];
        ctx.fillText(ch, i * step, drops[i] * step);
        if (drops[i] * step > cv.height && Math.random() > 0.975) drops[i] = 0;
        drops[i] += 1;
      }
    }

    let raf = null;
    let last = 0;
    const interval = 50 / Math.max(o.speed, 0.1);
    function loop(t) {
      raf = global.requestAnimationFrame(loop);
      if (t - last < interval) return;
      last = t;
      frame();
    }

    const onResize = () => resize();
    resize();
    global.addEventListener("resize", onResize);
    raf = global.requestAnimationFrame(loop);

    return {
      stop() {
        global.cancelAnimationFrame(raf);
        global.removeEventListener("resize", onResize);
        ctx.clearRect(0, 0, cv.width, cv.height);
      }
    };
  }

  const api = { start: start, CHARS: DEFAULT_CHARS };
  global.NeonMatrix = api;

  // Tu dong chay neu tim thay #nt-matrix
  if (document.readyState !== "loading") autoStart();
  else document.addEventListener("DOMContentLoaded", autoStart);
  function autoStart() {
    if (document.querySelector("#nt-matrix")) start();
  }
})(window);