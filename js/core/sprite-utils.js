(function () {
  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  const SPRITE_BOUNDS_CACHE = new Map();

  function containFill(boxW, boxH, iw, ih) {
    if (!(boxW > 0 && boxH > 0 && iw > 0 && ih > 0)) return { heightFill: 0, widthFill: 0 };
    const s = Math.min(boxW / iw, boxH / ih);
    const drawW = iw * s;
    const drawH = ih * s;
    return {
      widthFill: clamp(drawW / boxW, 0.01, 1),
      heightFill: clamp(drawH / boxH, 0.01, 1),
    };
  }

  function autoScaleSprite(img, opts) {
    if (!(img instanceof HTMLImageElement)) return;
    const target = clamp(Number(opts?.target ?? 0.93), 0.70, 0.98);
    const minScale = clamp(Number(opts?.min ?? 1.0), 0.70, 1.2);
    const maxScale = clamp(Number(opts?.max ?? 2.85), 1.0, 3.25);
    const fillH = (typeof opts?.fillH === "number" && isFinite(opts.fillH))
      ? clamp(Number(opts.fillH), 0.55, 0.98)
      : null;
    const src = String(img.currentSrc || img.src || img.getAttribute("src") || "").trim();
    if (!src) return;

    const apply = (meta) => {
      const boxEl = img.parentElement || img;
      const rect = boxEl.getBoundingClientRect ? boxEl.getBoundingClientRect() : img.getBoundingClientRect();
      const boxW = rect?.width || boxEl.clientWidth || 0;
      const boxH = rect?.height || boxEl.clientHeight || 0;
      const iw = img.naturalWidth || 0;
      const ih = img.naturalHeight || 0;

      const areaFill = meta?.areaFill ?? 1;
      let scaleArea = target / clamp(areaFill, 0.01, 1);
      if (!isFinite(scaleArea)) scaleArea = 1;

      let scaleHeight = 1;
      if (fillH != null && boxW > 0 && boxH > 0 && iw > 0 && ih > 0) {
        const fill = containFill(boxW, boxH, iw, ih);
        const visH = fill.heightFill * clamp(meta?.ratioH ?? 1, 0.01, 1);
        if (visH > 0) scaleHeight = fillH / visH;
      }

      let scale = Math.max(minScale, 1, scaleArea, scaleHeight);
      scale = clamp(scale, minScale, maxScale);
      img.style.setProperty("--spriteScale", String(scale));
    };

    const cached = SPRITE_BOUNDS_CACHE.get(src);
    if (cached) {
      apply(cached);
      return;
    }

    const run = () => {
      const iw = img.naturalWidth || 0;
      const ih = img.naturalHeight || 0;
      if (!(iw > 0 && ih > 0)) {
        apply(null);
        return;
      }

      try {
        const c = document.createElement("canvas");
        const ctx = c.getContext("2d", { willReadFrequently: true });
        if (!ctx) {
          apply(null);
          return;
        }
        c.width = iw;
        c.height = ih;
        ctx.drawImage(img, 0, 0);
        const data = ctx.getImageData(0, 0, iw, ih).data;
        let minX = iw, minY = ih, maxX = -1, maxY = -1, count = 0;
        for (let y = 0; y < ih; y += 1) {
          for (let x = 0; x < iw; x += 1) {
            const a = data[((y * iw) + x) * 4 + 3];
            if (a > 10) {
              count += 1;
              if (x < minX) minX = x;
              if (y < minY) minY = y;
              if (x > maxX) maxX = x;
              if (y > maxY) maxY = y;
            }
          }
        }
        if (count <= 0 || maxX < minX || maxY < minY) {
          apply(null);
          return;
        }
        const visW = (maxX - minX + 1);
        const visH = (maxY - minY + 1);
        const meta = {
          ratioW: clamp(visW / iw, 0.01, 1),
          ratioH: clamp(visH / ih, 0.01, 1),
          areaFill: clamp(count / (iw * ih), 0.01, 1),
        };
        SPRITE_BOUNDS_CACHE.set(src, meta);
        apply(meta);
      } catch {
        apply(null);
      }
    };

    if (img.complete && img.naturalWidth) run();
    else img.addEventListener("load", run, { once: true });
  }

  function autoScaleSpritesIn(scope) {
    if (!scope) return;
    const imgs = scope.querySelectorAll("img");
    imgs.forEach((im) => {
      if (!(im instanceof HTMLImageElement)) return;
      if (im.classList.contains("rpgSpriteImg")) {
        autoScaleSprite(im, { target: 0.93, max: 2.85, fillH: 0.86 });
        return;
      }
      if (im.classList.contains("rpgCodexSprite")) {
        autoScaleSprite(im, { target: 0.92, max: 2.15, fillH: 0.92 });
        return;
      }
      if (im.closest(".rpgCharSprite")) {
        autoScaleSprite(im, { target: 0.92, max: 2.15, fillH: 0.92 });
      }
    });
  }

  window.TinyTurnRPGModules = window.TinyTurnRPGModules || {};
  window.TinyTurnRPGModules.autoScaleSprite = autoScaleSprite;
  window.TinyTurnRPGModules.autoScaleSpritesIn = autoScaleSpritesIn;
})();
