import React, { useEffect, useRef, useState } from "react";

// Posterizer Pro — Single-file React demo
// Artist-neutral surf/skate poster aesthetic preview
// - Upload an image, tweak controls, and see the stylized result side-by-side
// - All processing is client-side using Canvas (no external APIs)
// - This is a simplified visual mock of the pipeline (posterization + edges + motifs)

export default function PosterizerPro() {
  const [imgURL, setImgURL] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Controls
  const [styleIntensity, setStyleIntensity] = useState(0.7); // 0–1
  const [outlineWeight, setOutlineWeight] = useState(0.8); // 0.3–1.0
  const [saturationBoost, setSaturationBoost] = useState(0.3); // 0–0.5
  const [motifPack, setMotifPack] = useState<"none" | "waves" | "flames" | "psychedelia">("waves");
  const [halftone, setHalftone] = useState(true);
  const [halftoneDensity, setHalftoneDensity] = useState(0.15); // 0–0.4
  const [burstStrength, setBurstStrength] = useState(0.5); // 0–1
  const [transparentBG, setTransparentBG] = useState(false);

  const originalCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const stylizedCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const [imgDims, setImgDims] = useState({ w: 0, h: 0 });

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    setImgURL(url);
  }

  // Draw background burst motif
  function drawBurst(ctx: CanvasRenderingContext2D, w: number, h: number, strength: number) {
    if (strength <= 0.01) return;
    const cx = w / 2;
    const cy = h / 2;
    const rays = Math.floor(64 * strength) + 16; // 16–80 rays
    ctx.save();
    ctx.globalAlpha = 0.25 * strength;
    for (let i = 0; i < rays; i++) {
      const angle = (i / rays) * Math.PI * 2;
      ctx.beginPath();
      const x1 = cx + Math.cos(angle) * 20;
      const y1 = cy + Math.sin(angle) * 20;
      const x2 = cx + Math.cos(angle) * Math.max(w, h);
      const y2 = cy + Math.sin(angle) * Math.max(w, h);
      ctx.moveTo(cx, cy);
      ctx.lineTo(x2, y2);
      ctx.lineWidth = 3;
      ctx.strokeStyle = "#000000";
      ctx.stroke();
    }
    ctx.restore();
  }

  // Procedural halftone overlay
  function drawHalftone(ctx: CanvasRenderingContext2D, w: number, h: number, density: number) {
    if (!halftone || density <= 0.01) return;
    const spacing = 12 - Math.floor(density * 20); // larger density → smaller spacing
    const radius = Math.max(1, Math.floor(spacing / 4));
    ctx.save();
    ctx.globalAlpha = 0.15 + density * 0.25;
    ctx.fillStyle = "#000";
    for (let y = radius; y < h; y += spacing) {
      for (let x = radius; x < w; x += spacing) {
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  // Simple posterization (reduce levels) + saturation boost
  function posterizeAndSaturate(imageData: ImageData, levels = 6, satBoost = 0.3) {
    const d = imageData.data;
    const step = 255 / Math.max(2, levels - 1);
    for (let i = 0; i < d.length; i += 4) {
      let r = d[i], g = d[i + 1], b = d[i + 2], a = d[i + 3];
      // Convert to HSL, boost saturation
      const { h, s, l } = rgbToHsl(r, g, b);
      const s2 = clamp01(s + satBoost * (1 - s));
      const { r: r2, g: g2, b: b2 } = hslToRgb(h, s2, l);
      // Posterize per channel
      d[i] = Math.round(r2 / step) * step;
      d[i + 1] = Math.round(g2 / step) * step;
      d[i + 2] = Math.round(b2 / step) * step;
      d[i + 3] = a;
    }
    return imageData;
  }

  // Sobel edge detection → black edges on transparent
  function sobelEdges(srcCtx: CanvasRenderingContext2D, w: number, h: number, threshold: number) {
    const src = srcCtx.getImageData(0, 0, w, h);
    const out = srcCtx.createImageData(w, h);

    function idx(x: number, y: number) { return (y * w + x) * 4; }

    const gx = [
      -1, 0, 1,
      -2, 0, 2,
      -1, 0, 1,
    ];
    const gy = [
      -1, -2, -1,
       0,  0,  0,
       1,  2,  1,
    ];

    const d = src.data;
    const o = out.data;

    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        let sx = 0, sy = 0;
        let k = 0;
        for (let j = -1; j <= 1; j++) {
          for (let i = -1; i <= 1; i++) {
            const p = idx(x + i, y + j);
            // grayscale luminance
            const lum = 0.2126 * d[p] + 0.7152 * d[p + 1] + 0.0722 * d[p + 2];
            sx += lum * gx[k];
            sy += lum * gy[k];
            k++;
          }
        }
        const mag = Math.sqrt(sx * sx + sy * sy);
        const isEdge = mag > threshold;
        const q = idx(x, y);
        o[q] = 0; o[q + 1] = 0; o[q + 2] = 0; o[q + 3] = isEdge ? 255 : 0;
      }
    }
    return out;
  }

  // Composite pipeline
  function stylize() {
    if (!imgURL || !stylizedCanvasRef.current || !originalCanvasRef.current) return;
    setLoading(true);
    const ocan = originalCanvasRef.current;
    const scan = stylizedCanvasRef.current;
    const w = ocan.width;
    const h = ocan.height;
    const octx = ocan.getContext("2d")!;
    const sctx = scan.getContext("2d")!;

    // Clear
    sctx.clearRect(0, 0, w, h);

    // Optional transparent background
    if (!transparentBG) {
      // Subtle colored backdrop to help the poster look
      sctx.fillStyle = "#f6f6f6";
      sctx.fillRect(0, 0, w, h);
    }

    // Background burst first
    sctx.save();
    sctx.globalCompositeOperation = "multiply";
    drawBurst(sctx, w, h, burstStrength * styleIntensity);
    sctx.restore();

    // Base image → posterize + saturation
    const base = octx.getImageData(0, 0, w, h);
    const levels = Math.floor(5 + styleIntensity * 5); // 5–10
    const satBoost = saturationBoost * (0.3 + styleIntensity * 0.7); // amplify by intensity
    const poster = posterizeAndSaturate(copyImageData(octx, base), levels, satBoost);
    sctx.putImageData(poster, 0, 0);

    // Motif overlays (draw behind edges)
    drawMotifs(sctx, w, h, motifPack, styleIntensity);

    // Edges from original (stronger threshold when lower outlineWeight)
    const edgeThreshold = 100 - outlineWeight * 80; // 20–100
    const edges = sobelEdges(octx, w, h, edgeThreshold);

    // Thicken edges by drawing blurred, then threshold via composite
    const tmp = document.createElement("canvas");
    tmp.width = w; tmp.height = h;
    const tctx = tmp.getContext("2d")!;
    tctx.putImageData(edges, 0, 0);
    const thickenPx = Math.floor(1 + outlineWeight * 3); // 1–4 px blur approximation
    tctx.filter = `blur(${thickenPx}px)`;
    tctx.globalCompositeOperation = "source-over";
    tctx.drawImage(tmp, 0, 0);

    // Draw edges onto stylized canvas
    sctx.save();
    sctx.globalAlpha = 0.9;
    sctx.drawImage(tmp, 0, 0);
    sctx.restore();

    // Halftone overlay
    drawHalftone(sctx, w, h, halftone ? halftoneDensity : 0);

    setLoading(false);
  }

  function copyImageData(ctx: CanvasRenderingContext2D, src: ImageData) {
    const dst = ctx.createImageData(src.width, src.height);
    dst.data.set(src.data);
    return dst;
  }

  function drawMotifs(ctx: CanvasRenderingContext2D, w: number, h: number, pack: string, intensity: number) {
    if (pack === "none") return;
    ctx.save();
    ctx.globalAlpha = 0.4 * intensity;
    ctx.globalCompositeOperation = "multiply";

    if (pack === "waves") {
      // Curling wave arcs
      const curls = Math.floor(3 + intensity * 5);
      for (let i = 0; i < curls; i++) {
        const cx = (w / (curls + 1)) * (i + 1);
        const cy = h * (0.65 + 0.25 * Math.sin(i));
        drawWave(ctx, cx, cy, Math.min(w, h) * 0.35, 0.8 + 0.2 * Math.cos(i));
      }
    } else if (pack === "flames") {
      const tongues = Math.floor(25 + intensity * 40);
      ctx.translate(0, h * 0.85);
      for (let i = 0; i < tongues; i++) {
        const x = (i / tongues) * w;
        drawFlame(ctx, x, 0, h * (0.2 + Math.random() * 0.25));
      }
    } else if (pack === "psychedelia") {
      const spirals = Math.floor(4 + intensity * 6);
      for (let i = 0; i < spirals; i++) {
        const cx = (i % 2 === 0 ? w * 0.25 : w * 0.75) + (Math.random() - 0.5) * w * 0.1;
        const cy = (i < spirals / 2 ? h * 0.3 : h * 0.7) + (Math.random() - 0.5) * h * 0.1;
        drawSpiral(ctx, cx, cy, Math.min(w, h) * (0.15 + Math.random() * 0.2));
      }
    }

    ctx.restore();
  }

  function drawWave(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, tightness: number) {
    ctx.save();
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let a = Math.PI * 0.2; a < Math.PI * 1.4; a += 0.05) {
      const t = a - Math.PI * 0.2;
      const rr = r * (1 - t / (Math.PI * 1.2));
      const x = cx + Math.cos(a) * rr;
      const y = cy + Math.sin(a) * rr * tightness;
      if (a === Math.PI * 0.2) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawFlame(ctx: CanvasRenderingContext2D, x: number, y: number, height: number) {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x, y);
    const wobble = (Math.random() - 0.5) * 20;
    ctx.bezierCurveTo(x - 10 + wobble, y - height * 0.3, x - 6 + wobble, y - height * 0.7, x, y - height);
    ctx.bezierCurveTo(x + 6 + wobble, y - height * 0.7, x + 10 + wobble, y - height * 0.3, x, y);
    ctx.closePath();
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }

  function drawSpiral(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
    ctx.save();
    ctx.beginPath();
    let a = 0;
    const turns = 3;
    const steps = 200;
    for (let i = 0; i < steps; i++) {
      a = (i / steps) * Math.PI * 2 * turns;
      const rr = (i / steps) * r;
      const x = cx + Math.cos(a) * rr;
      const y = cy + Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }

  // Helpers: color conversions
  function clamp01(v: number) { return Math.max(0, Math.min(1, v)); }
  function rgbToHsl(r: number, g: number, b: number) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0, l = (max + min) / 2;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        case b: h = (r - g) / d + 4; break;
      }
      h /= 6;
    }
    return { h, s, l };
  }
  function hslToRgb(h: number, s: number, l: number) {
    let r: number, g: number, b: number;
    if (s === 0) { r = g = b = l; }
    else {
      const hue2rgb = (p: number, q: number, t: number) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
      };
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      r = hue2rgb(p, q, h + 1 / 3);
      g = hue2rgb(p, q, h);
      b = hue2rgb(p, q, h - 1 / 3);
    }
    return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
  }

  // Load image to original canvas
  useEffect(() => {
    if (!imgURL || !originalCanvasRef.current || !stylizedCanvasRef.current) return;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const maxSide = 768; // demo size
      const ratio = img.width / img.height;
      let w = img.width, h = img.height;
      if (w > h && w > maxSide) { h = Math.round((maxSide / w) * h); w = maxSide; }
      else if (h >= w && h > maxSide) { w = Math.round((maxSide / h) * w); h = maxSide; }

      const ocan = originalCanvasRef.current!;
      const scan = stylizedCanvasRef.current!;
      ocan.width = w; ocan.height = h;
      scan.width = w; scan.height = h;

      const octx = ocan.getContext("2d")!;
      octx.clearRect(0, 0, w, h);
      octx.drawImage(img, 0, 0, w, h);
      setImgDims({ w, h });
      stylize();
    };
    img.src = imgURL;
  }, [imgURL]);

  // Re-render when core controls change
  useEffect(() => {
    stylize();
  }, [styleIntensity, outlineWeight, saturationBoost, motifPack, halftone, halftoneDensity, burstStrength, transparentBG]);

  // =====================
  // Style Profile system
  // =====================
  type RGB = { r: number; g: number; b: number };
  type StyleProfile = {
    name: string;
    palette: RGB[];
    meanSaturation: number;
    saturationStd: number;
    edgeDensity: number;
    contrastIndex: number;
    suggested: {
      outlineWeight: number;
      saturationBoost: number;
      halftoneDensity: number;
      burstStrength: number;
      motifPack: "none" | "waves" | "flames" | "psychedelia";
      styleIntensity: number;
      applyPalette: boolean;
    };
  };

  const [referenceURLs, setReferenceURLs] = useState<string[]>([]);
  const [profile, setProfile] = useState<StyleProfile | null>(null);
  const [applyPaletteTransfer, setApplyPaletteTransfer] = useState(true);
  const [autoApplyProfile, setAutoApplyProfile] = useState(true);
  const profileStorageKey = "posterizerpro.profile";

  function onReferenceFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const urls: string[] = [];
    for (let i = 0; i < files.length; i++) urls.push(URL.createObjectURL(files[i]!));
    setReferenceURLs(prev => [...prev, ...urls]);
  }

  async function analyzeReferences() {
    if (referenceURLs.length === 0) return;
    const sampleSize = 256;
    const allSamples: RGB[] = [];
    let totalMeanSat = 0, totalSatStd = 0, totalEdgeDensity = 0, totalContrast = 0, counted = 0;
    for (const url of referenceURLs) {
      const img = await loadImage(url);
      const { canvas, ctx } = makeTempCanvas();
      const dim = fitWithin(img.width, img.height, sampleSize, sampleSize);
      canvas.width = dim.w; canvas.height = dim.h;
      ctx.drawImage(img, 0, 0, dim.w, dim.h);
      const data = ctx.getImageData(0, 0, dim.w, dim.h);
      const { samples, meanSat, satStd, contrastIdx } = samplePixelsAndStats(data, 4000);
      allSamples.push(...samples);
      const edge = estimateEdgeDensity(ctx, dim.w, dim.h);
      totalMeanSat += meanSat; totalSatStd += satStd; totalEdgeDensity += edge; totalContrast += contrastIdx; counted++;
    }
    const K = 6;
    const palette = kmeansPalette(allSamples, K);
    const meanSaturation = totalMeanSat / counted;
    const saturationStd = totalSatStd / counted;
    const edgeDensity = totalEdgeDensity / counted;
    const contrastIndex = totalContrast / counted;
    const suggested = suggestControls({ palette, meanSaturation, saturationStd, edgeDensity, contrastIndex });
    const prof: StyleProfile = { name: "CustomProfile", palette, meanSaturation, saturationStd, edgeDensity, contrastIndex, suggested };
    setProfile(prof);
    if (autoApplyProfile) applySuggested(suggested);
    localStorage.setItem(profileStorageKey, JSON.stringify(prof));
  }

  function applySuggested(s: StyleProfile["suggested"]) {
    setOutlineWeight(s.outlineWeight);
    setSaturationBoost(s.saturationBoost);
    setHalftoneDensity(s.halftoneDensity);
    setBurstStrength(s.burstStrength);
    setMotifPack(s.motifPack);
    setStyleIntensity(s.styleIntensity);
    setApplyPaletteTransfer(s.applyPalette);
  }

  function loadSavedProfile() {
    const raw = localStorage.getItem(profileStorageKey);
    if (!raw) return;
    try {
      const prof: StyleProfile = JSON.parse(raw);
      setProfile(prof);
      if (autoApplyProfile) applySuggested(prof.suggested);
    } catch {}
  }

  function exportProfileJSON() {
    if (!profile) return;
    const blob = new Blob([JSON.stringify(profile, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `${profile.name || "profile"}.json`; a.click(); URL.revokeObjectURL(url);
  }

  function importProfileJSON(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const prof: StyleProfile = JSON.parse(String(reader.result));
        setProfile(prof);
        if (autoApplyProfile) applySuggested(prof.suggested);
        localStorage.setItem(profileStorageKey, JSON.stringify(prof));
      } catch {}
    };
    reader.readAsText(file);
  }

  // Helpers: profile analysis
  function makeTempCanvas() { const canvas = document.createElement("canvas"); return { canvas, ctx: canvas.getContext("2d")! }; }
  function fitWithin(w: number, h: number, maxW: number, maxH: number) { const r = Math.min(maxW / w, maxH / h, 1); return { w: Math.max(1, Math.round(w * r)), h: Math.max(1, Math.round(h * r)) }; }
  function loadImage(url: string) { return new Promise<HTMLImageElement>((resolve) => { const img = new Image(); img.crossOrigin = "anonymous"; img.onload = () => resolve(img); img.src = url; }); }

  function samplePixelsAndStats(img: ImageData, maxSamples: number) {
    const d = img.data; const step = Math.max(1, Math.floor((d.length / 4) / maxSamples));
    const samples: RGB[] = []; const sats: number[] = []; const lums: number[] = [];
    for (let i = 0; i < d.length; i += 4 * step) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      const { s, l } = rgbToHsl(r, g, b);
      samples.push({ r, g, b }); sats.push(s); lums.push(l);
    }
    const meanSat = average(sats); const satStd = stddev(sats, meanSat); const contrastIdx = stddev(lums, average(lums));
    return { samples, meanSat, satStd, contrastIdx };
  }

  function estimateEdgeDensity(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const src = ctx.getImageData(0, 0, w, h);
    const tmpCanvas = document.createElement("canvas"); tmpCanvas.width = w; tmpCanvas.height = h;
    const tctx = tmpCanvas.getContext("2d")!; tctx.putImageData(src, 0, 0);
    const edges = sobelEdges(tctx, w, h, 50);
    let count = 0; for (let i = 3; i < edges.data.length; i += 4) { if (edges.data[i] > 0) count++; }
    return count / (w * h);
  }

  function kmeansPalette(samples: RGB[], k: number): RGB[] {
    if (samples.length === 0) return [];
    const centers: RGB[] = []; for (let i = 0; i < k; i++) centers.push(samples[Math.floor(Math.random() * samples.length)]);
    const assignments = new Array<number>(samples.length).fill(0);
    for (let iter = 0; iter < 8; iter++) {
      for (let i = 0; i < samples.length; i++) assignments[i] = closestColorIndex(samples[i], centers);
      const sums = Array.from({ length: k }, () => ({ r: 0, g: 0, b: 0, c: 0 }));
      for (let i = 0; i < samples.length; i++) { const g = assignments[i]; sums[g].r += samples[i].r; sums[g].g += samples[i].g; sums[g].b += samples[i].b; sums[g].c++; }
      for (let j = 0; j < k; j++) if (sums[j].c > 0) centers[j] = { r: Math.round(sums[j].r / sums[j].c), g: Math.round(sums[j].g / sums[j].c), b: Math.round(sums[j].b / sums[j].c) };
    }
    return centers.sort((a, b) => (0.2126 * a.r + 0.7152 * a.g + 0.0722 * a.b) - (0.2126 * b.r + 0.7152 * b.g + 0.0722 * b.b));
  }

  function closestColorIndex(c: RGB, palette: RGB[]) {
    let bi = 0; let bd = Infinity;
    for (let i = 0; i < palette.length; i++) {
      const p = palette[i]; const d = (c.r - p.r) ** 2 + (c.g - p.g) ** 2 + (c.b - p.b) ** 2;
      if (d < bd) { bd = d; bi = i; }
    }
    return bi;
  }

  function suggestControls(ctx: { palette: RGB[]; meanSaturation: number; saturationStd: number; edgeDensity: number; contrastIndex: number; }): StyleProfile["suggested"] {
    const meanSat = ctx.meanSaturation; const edge = ctx.edgeDensity; const contrast = ctx.contrastIndex;
    const outline = clamp01(0.4 + edge * 2);
    const satBoost = clamp01(0.2 + (0.6 - meanSat) * 0.6);
    const halftoneD = clamp01(0.05 + contrast * 0.6);
    const burst = clamp01(0.3 + contrast * 0.5);
    const hueBias = estimateHueBias(ctx.palette);
    const motif: "none" | "waves" | "flames" | "psychedelia" = hueBias === "cool" ? "waves" : hueBias === "warm" ? "flames" : "psychedelia";
    const intensity = clamp01(0.6 + contrast * 0.3);
    return { outlineWeight: outline, saturationBoost: satBoost, halftoneDensity: halftoneD, burstStrength: burst, motifPack: motif, styleIntensity: intensity, applyPalette: true };
  }

  function estimateHueBias(palette: RGB[]) {
    let warm = 0, cool = 0;
    for (const c of palette) {
      const { h, s } = rgbToHsl(c.r, c.g, c.b);
      if (s < 0.15) continue;
      if (h < 1 / 6 || h > 5 / 6) warm += 1; else if (h > 1 / 3 && h < 2 / 3) cool += 1;
    }
    if (warm > cool * 1.2) return "warm"; if (cool > warm * 1.2) return "cool"; return "mixed";
  }

  function average(arr: number[]) { if (arr.length === 0) return 0; return arr.reduce((a, b) => a + b, 0) / arr.length; }
  function stddev(arr: number[], mean: number) { if (arr.length === 0) return 0; const v = arr.reduce((acc, x) => acc + (x - mean) ** 2, 0) / arr.length; return Math.sqrt(v); }

  // Palette transfer applied after base stylization when toggled
  function applyPaletteToImageData(imageData: ImageData, palette: RGB[]) {
    if (!palette || palette.length === 0) return imageData;
    const d = imageData.data;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      const idx = closestColorIndex({ r, g, b }, palette);
      const p = palette[idx];
      d[i] = p.r; d[i + 1] = p.g; d[i + 2] = p.b;
    }
    return imageData;
  }

  useEffect(() => {
    if (!profile || !applyPaletteTransfer || !stylizedCanvasRef.current) return;
    const can = stylizedCanvasRef.current; const ctx = can.getContext("2d")!;
    try {
      const img = ctx.getImageData(0, 0, can.width, can.height);
      const mapped = applyPaletteToImageData(img, profile.palette);
      ctx.putImageData(mapped, 0, 0);
    } catch {}
  }, [profile, applyPaletteTransfer, styleIntensity, outlineWeight, saturationBoost, motifPack, halftone, halftoneDensity, burstStrength, transparentBG, imgURL]);

  return (
    <div style={{ fontFamily: "Inter, system-ui, sans-serif", color: "#111", padding: 16 }}>
      <h2 style={{ marginTop: 0 }}>Posterizer Pro</h2>
      <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 16 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ padding: 12, border: "1px solid #ddd", borderRadius: 8 }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Input</div>
            <input type="file" accept="image/*" onChange={onFile} />
            <div style={{ marginTop: 8 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input type="checkbox" checked={transparentBG} onChange={e => setTransparentBG(e.target.checked)} /> Transparent Background
              </label>
            </div>
          </div>

          <div style={{ padding: 12, border: "1px solid #ddd", borderRadius: 8 }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Style Controls</div>
            <Slider label="Style Intensity" value={styleIntensity} setValue={setStyleIntensity} min={0} max={1} step={0.01} />
            <Slider label="Outline Weight" value={outlineWeight} setValue={setOutlineWeight} min={0.3} max={1} step={0.01} />
            <Slider label="Saturation Boost" value={saturationBoost} setValue={setSaturationBoost} min={0} max={0.5} step={0.01} />
            <div style={{ margin: "8px 0" }}>
              <label>Motifs:</label>
              <select value={motifPack} onChange={e => setMotifPack(e.target.value as any)} style={{ marginLeft: 8 }}>
                <option value="none">None</option>
                <option value="waves">Waves</option>
                <option value="flames">Flames</option>
                <option value="psychedelia">Psychedelia</option>
              </select>
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input type="checkbox" checked={halftone} onChange={e => setHalftone(e.target.checked)} /> Halftone
            </label>
            <Slider label="Halftone Density" value={halftoneDensity} setValue={setHalftoneDensity} min={0} max={0.4} step={0.005} />
            <Slider label="Burst Strength" value={burstStrength} setValue={setBurstStrength} min={0} max={1} step={0.01} />
          </div>

          <div style={{ padding: 12, border: "1px solid #ddd", borderRadius: 8 }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Reference Set & Profile</div>
            <input type="file" accept="image/*" multiple onChange={onReferenceFiles} />
            <div style={{ fontSize: 12, color: "#555", marginTop: 4 }}>{referenceURLs.length} reference images</div>
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button onClick={analyzeReferences} disabled={referenceURLs.length === 0}>Analyze</button>
              <button onClick={loadSavedProfile}>Load Saved</button>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <input type="checkbox" checked={autoApplyProfile} onChange={e => setAutoApplyProfile(e.target.checked)} /> Auto-apply
              </label>
            </div>
            {profile && (
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 12, color: "#333", marginBottom: 6 }}>Palette</div>
                <div style={{ display: "flex", gap: 4 }}>
                  {profile.palette.map((c, i) => (
                    <div key={i} title={`rgb(${c.r},${c.g},${c.b})`} style={{ width: 20, height: 20, background: `rgb(${c.r},${c.g},${c.b})`, border: "1px solid #ccc" }} />
                  ))}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
                  <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <input type="checkbox" checked={applyPaletteTransfer} onChange={e => setApplyPaletteTransfer(e.target.checked)} /> Apply Palette Transfer
                  </label>
                  <button onClick={exportProfileJSON}>Export JSON</button>
                  <label style={{ cursor: "pointer" }}>
                    <span style={{ border: "1px solid #ccc", borderRadius: 4, padding: "4px 8px" }}>Import JSON</span>
                    <input type="file" accept="application/json" style={{ display: "none" }} onChange={importProfileJSON} />
                  </label>
                </div>
              </div>
            )}
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <div style={{ fontSize: 12, color: "#555", marginBottom: 6 }}>Original</div>
            <canvas ref={originalCanvasRef} style={{ width: "100%", height: "auto", background: "#fafafa", border: "1px solid #eee" }} />
          </div>
          <div>
            <div style={{ fontSize: 12, color: "#555", marginBottom: 6 }}>Stylized</div>
            <canvas ref={stylizedCanvasRef} style={{ width: "100%", height: "auto", background: "#fff", border: "1px solid #eee" }} />
            {loading && <div style={{ fontSize: 12, color: "#666", marginTop: 6 }}>Rendering…</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
        