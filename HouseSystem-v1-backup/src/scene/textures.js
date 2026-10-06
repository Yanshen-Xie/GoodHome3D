// 程序化纹理：用 Canvas 2D 画出木地板、瓷砖、草地、墙面等贴图，不依赖外部图片文件。
// 每张贴图都记录了它代表的真实尺寸（米），配合 uv.js 中的"按世界尺寸设置 UV"，
// 保证贴到不同大小的物体上时纹理比例一致、不会被拉伸。
import * as THREE from 'three';

// 简单的可复现随机数（同一种纹理每次生成都一样）
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function canvas(size = 512) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d')];
}

// 给整张图加细小的明暗噪点，让表面不那么"塑料"
function noise(ctx, size, amount, seed) {
  const r = rng(seed);
  const img = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (r() - 0.5) * amount;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
}

function toTexture(c, worldSize, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.userData.worldSize = worldSize; // 这张图在真实世界中对应的边长（米）
  return t;
}

const painters = {
  // 木地板：长条木板错缝排列，每块颜色略有差异，带木纹
  woodFloor() {
    const S = 512, [c, g] = canvas(S), r = rng(7);
    const rows = 8, h = S / rows;
    for (let i = 0; i < rows; i++) {
      const offset = (i % 2) * S * 0.5 + r() * 60;
      for (let k = -1; k < 2; k++) {
        const x = offset + k * S;
        const tone = 150 + r() * 35;
        g.fillStyle = `rgb(${tone},${tone * 0.72},${tone * 0.48})`;
        g.fillRect(x, i * h, S, h);
        g.strokeStyle = 'rgba(70,40,20,0.18)';
        for (let l = 0; l < 6; l++) {
          g.beginPath();
          const y = i * h + r() * h;
          g.moveTo(x, y);
          g.bezierCurveTo(x + S * 0.3, y + (r() - 0.5) * 8, x + S * 0.6, y + (r() - 0.5) * 8, x + S, y);
          g.stroke();
        }
        g.fillStyle = 'rgba(40,20,10,0.55)';
        g.fillRect(x, i * h, 2, h);
      }
      g.fillStyle = 'rgba(40,20,10,0.5)';
      g.fillRect(0, i * h, S, 2);
    }
    noise(g, S, 14, 11);
    return toTexture(c, 3.2);
  },
  // 客厅、餐厅用的浅色大理石纹瓷砖（60cm × 60cm）
  tileFloor() {
    const S = 512, [c, g] = canvas(S), r = rng(3);
    const n = 4, w = S / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const t = 222 + r() * 14;
      g.fillStyle = `rgb(${t},${t - 3},${t - 8})`;
      g.fillRect(i * w, j * w, w, w);
      g.strokeStyle = 'rgba(150,140,130,0.25)';
      g.lineWidth = 1.5;
      for (let v = 0; v < 3; v++) {
        g.beginPath();
        g.moveTo(i * w + r() * w, j * w);
        g.quadraticCurveTo(i * w + r() * w, j * w + r() * w, i * w + r() * w, j * w + w);
        g.stroke();
      }
    }
    g.fillStyle = 'rgba(120,115,110,0.8)';
    for (let i = 0; i <= n; i++) { g.fillRect(i * w - 1, 0, 2, S); g.fillRect(0, i * w - 1, S, 2); }
    noise(g, S, 8, 5);
    return toTexture(c, 2.4);
  },
  // 卫生间、厨房的小方砖（防滑）
  bathTile() {
    const S = 512, [c, g] = canvas(S), r = rng(9);
    const n = 8, w = S / n;
    g.fillStyle = '#9aa3a8'; g.fillRect(0, 0, S, S);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const t = 196 + r() * 18;
      g.fillStyle = `rgb(${t - 8},${t},${t + 4})`;
      g.fillRect(i * w + 2, j * w + 2, w - 4, w - 4);
    }
    noise(g, S, 12, 13);
    return toTexture(c, 1.6);
  },
  // 室内乳胶漆墙面（很淡的颗粒感）
  wallPaint() {
    const S = 256, [c, g] = canvas(S);
    g.fillStyle = '#f1ede4'; g.fillRect(0, 0, S, S);
    noise(g, S, 10, 21);
    return toTexture(c, 1.5);
  },
  // 外墙：浅灰色石材干挂板
  exteriorWall() {
    const S = 512, [c, g] = canvas(S), r = rng(17);
    const rows = 4, cols = 2, h = S / rows, w = S / cols;
    for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
      const off = (i % 2) * w / 2;
      const t = 200 + r() * 20;
      g.fillStyle = `rgb(${t},${t - 4},${t - 12})`;
      g.fillRect(j * w + off, i * h, w, h);
      g.fillRect(j * w + off - S, i * h, w, h);
    }
    g.fillStyle = 'rgba(90,85,80,0.7)';
    for (let i = 0; i <= rows; i++) g.fillRect(0, i * h - 1.5, S, 3);
    for (let i = 0; i < rows; i++) for (let j = 0; j <= cols; j++) g.fillRect(j * w + (i % 2) * w / 2 - 1.5, i * h, 3, h);
    noise(g, S, 18, 19);
    return toTexture(c, 2.4);
  },
  // 草地
  grass() {
    const S = 512, [c, g] = canvas(S), r = rng(23);
    g.fillStyle = '#5b7f38'; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 9000; i++) {
      const x = r() * S, y = r() * S;
      const t = r();
      g.strokeStyle = `rgba(${60 + t * 70},${100 + t * 70},${30 + t * 30},0.55)`;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 4, y - 3 - r() * 5); g.stroke();
    }
    return toTexture(c, 3);
  },
  // 室外铺装（小路、露台）
  paving() {
    const S = 512, [c, g] = canvas(S), r = rng(29);
    g.fillStyle = '#7d766c'; g.fillRect(0, 0, S, S);
    const n = 4, w = S / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n * 2; j++) {
      const t = 165 + r() * 30;
      g.fillStyle = `rgb(${t},${t - 6},${t - 16})`;
      g.fillRect(i * w + 3 + (j % 2) * w / 2, j * w / 2 + 3, w - 6, w / 2 - 6);
      g.fillRect(i * w + 3 + (j % 2) * w / 2 - S, j * w / 2 + 3, w - 6, w / 2 - 6);
    }
    noise(g, S, 20, 31);
    return toTexture(c, 2.4);
  },
  // 木平台（室外防腐木）
  deck() {
    const S = 512, [c, g] = canvas(S), r = rng(37);
    const n = 8, h = S / n;
    for (let i = 0; i < n; i++) {
      const t = 120 + r() * 30;
      g.fillStyle = `rgb(${t},${t * 0.75},${t * 0.55})`;
      g.fillRect(0, i * h, S, h - 4);
      g.fillStyle = '#2c2119'; g.fillRect(0, i * h + h - 4, S, 4);
    }
    noise(g, S, 16, 41);
    return toTexture(c, 1.6);
  },
  // 柏油路
  asphalt() {
    const S = 256, [c, g] = canvas(S);
    g.fillStyle = '#44464a'; g.fillRect(0, 0, S, S);
    noise(g, S, 30, 43);
    return toTexture(c, 2);
  },
  // 布艺（沙发、床品）：细密的经纬交织
  fabric() {
    const S = 256, [c, g] = canvas(S);
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, S, S);
    for (let i = 0; i < S; i += 4) {
      g.fillStyle = 'rgba(0,0,0,0.06)'; g.fillRect(i, 0, 2, S);
      g.fillStyle = 'rgba(0,0,0,0.04)'; g.fillRect(0, i, S, 2);
    }
    noise(g, S, 14, 47);
    return toTexture(c, 0.4);
  },
  // 家具木纹（纵向）
  woodGrain() {
    const S = 512, [c, g] = canvas(S), r = rng(53);
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 70; i++) {
      g.strokeStyle = `rgba(90,55,25,${0.05 + r() * 0.12})`;
      g.lineWidth = 1 + r() * 3;
      const x = r() * S;
      g.beginPath(); g.moveTo(x, 0);
      g.bezierCurveTo(x + (r() - 0.5) * 30, S / 3, x + (r() - 0.5) * 30, S * 2 / 3, x, S);
      g.stroke();
    }
    return toTexture(c, 1.2);
  },
  // 地毯：带简单几何图案
  rug() {
    const S = 512, [c, g] = canvas(S);
    g.fillStyle = '#8a9aa8'; g.fillRect(0, 0, S, S);
    g.strokeStyle = '#e9e3d6'; g.lineWidth = 10; g.strokeRect(30, 30, S - 60, S - 60);
    g.lineWidth = 4; g.strokeRect(60, 60, S - 120, S - 120);
    g.fillStyle = 'rgba(233,227,214,0.5)';
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
      g.beginPath(); g.arc(128 + i * 85, 128 + j * 85, 18, 0, Math.PI * 2); g.fill();
    }
    noise(g, S, 20, 59);
    return toTexture(c, 1);
  },
  // 屋面防水层
  roof() {
    const S = 256, [c, g] = canvas(S);
    g.fillStyle = '#8c8f93'; g.fillRect(0, 0, S, S);
    noise(g, S, 26, 61);
    return toTexture(c, 2);
  },
  // 光伏板：深蓝色电池片网格
  solarPanel() {
    const S = 512, [c, g] = canvas(S);
    g.fillStyle = '#c8ccd2'; g.fillRect(0, 0, S, S);
    const cols = 6, rows = 10, w = (S - 20) / cols, h = (S - 20) / rows;
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      const grd = g.createLinearGradient(0, 10 + j * h, 0, 10 + (j + 1) * h);
      grd.addColorStop(0, '#1b2e5a'); grd.addColorStop(1, '#10204a');
      g.fillStyle = grd;
      g.fillRect(10 + i * w + 1.5, 10 + j * h + 1.5, w - 3, h - 3);
      g.fillStyle = 'rgba(200,210,230,0.35)';
      g.fillRect(10 + i * w + w / 2 - 0.5, 10 + j * h + 1.5, 1, h - 3);
    }
    const t = toTexture(c, 1);
    return t;
  },
  // 大理石台面
  marble() {
    const S = 512, [c, g] = canvas(S), r = rng(67);
    g.fillStyle = '#ecebe7'; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 25; i++) {
      g.strokeStyle = `rgba(120,120,125,${0.08 + r() * 0.15})`;
      g.lineWidth = 0.5 + r() * 2;
      g.beginPath();
      let x = r() * S, y = r() * S;
      g.moveTo(x, y);
      for (let k = 0; k < 6; k++) { x += (r() - 0.3) * 120; y += (r() - 0.5) * 120; g.lineTo(x, y); }
      g.stroke();
    }
    return toTexture(c, 1.2);
  },
  // 树皮
  bark() {
    const S = 256, [c, g] = canvas(S), r = rng(71);
    g.fillStyle = '#5a4331'; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 60; i++) {
      g.fillStyle = `rgba(30,20,12,${0.2 + r() * 0.3})`;
      g.fillRect(r() * S, 0, 1 + r() * 3, S);
    }
    return toTexture(c, 1);
  },
};

const cache = new Map();
/** 取得一张程序化贴图（同名只生成一次） */
export function getTexture(name) {
  if (!cache.has(name)) {
    const p = painters[name];
    if (!p) throw new Error('未知纹理: ' + name);
    cache.set(name, p());
  }
  return cache.get(name);
}

/** 生成一张带文字的贴图（用于出口标志、屏幕等） */
export function textTexture(lines, { w = 256, h = 128, bg = '#1a7f3c', fg = '#ffffff', font = 'bold 48px sans-serif' } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  g.fillStyle = fg; g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle';
  const arr = Array.isArray(lines) ? lines : [lines];
  arr.forEach((l, i) => g.fillText(l, w / 2, h / 2 + (i - (arr.length - 1) / 2) * (h / (arr.length + 0.5))));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
