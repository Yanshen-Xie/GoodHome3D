// 生成几件家具的 OBJ + MTL 模型文件（马桶、餐椅、花盆），供系统里自己写的 OBJ 解析器加载。
// 用法: node tools/make-obj.mjs   输出到 src/assets/models/
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.resolve('src/assets/models');
fs.mkdirSync(OUT, { recursive: true });

class ObjWriter {
  constructor(name) { this.name = name; this.lines = [`# ${name} — 由 tools/make-obj.mjs 生成`, `mtllib ${name}.mtl`]; this.nv = 0; this.nt = 0; this.nn = 0; }
  use(m) { this.lines.push(`usemtl ${m}`); }
  group(g) { this.lines.push(`o ${g}`); }
  // 长方体：中心 (cx,cy,cz)，尺寸 (w,h,d)，6 个面，每个面带 UV 和法线
  box(cx, cy, cz, w, h, d) {
    const x0 = cx - w / 2, x1 = cx + w / 2, y0 = cy - h / 2, y1 = cy + h / 2, z0 = cz - d / 2, z1 = cz + d / 2;
    const faces = [
      { n: [1, 0, 0], v: [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], s: [d, h] },
      { n: [-1, 0, 0], v: [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], s: [d, h] },
      { n: [0, 1, 0], v: [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], s: [w, d] },
      { n: [0, -1, 0], v: [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], s: [w, d] },
      { n: [0, 0, 1], v: [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], s: [w, h] },
      { n: [0, 0, -1], v: [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], s: [w, h] },
    ];
    for (const f of faces) {
      const base = this.nv, tb = this.nt;
      f.v.forEach((p) => this.lines.push(`v ${p.map((a) => a.toFixed(4)).join(' ')}`));
      [[0, 0], [f.s[0], 0], [f.s[0], f.s[1]], [0, f.s[1]]].forEach((t) => this.lines.push(`vt ${t[0].toFixed(4)} ${t[1].toFixed(4)}`));
      this.lines.push(`vn ${f.n.join(' ')}`);
      this.nv += 4; this.nt += 4; this.nn += 1;
      const n = this.nn;
      this.lines.push(`f ${base + 1}/${tb + 1}/${n} ${base + 2}/${tb + 2}/${n} ${base + 3}/${tb + 3}/${n} ${base + 4}/${tb + 4}/${n}`);
    }
  }
  /**
   * 旋转体（车削）：把轮廓线 [(r,y)...] 绕 y 轴旋转一周。sx/sz 可把圆压成椭圆。
   * 法线由轮廓切线求出（光滑着色）。
   */
  lathe(profile, seg, cx = 0, cy = 0, cz = 0, sx = 1, sz = 1) {
    const base = this.nv, tb = this.nt, nb = this.nn;
    const P = profile.length;
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      for (let k = 0; k < P; k++) {
        const [r, y] = profile[k];
        this.lines.push(`v ${(cx + r * c * sx).toFixed(4)} ${(cy + y).toFixed(4)} ${(cz + r * s * sz).toFixed(4)}`);
        this.lines.push(`vt ${(i / seg * 2).toFixed(4)} ${(k / (P - 1)).toFixed(4)}`);
        const p0 = profile[Math.max(0, k - 1)], p1 = profile[Math.min(P - 1, k + 1)];
        const dr = p1[0] - p0[0], dy = p1[1] - p0[1];
        let nr = dy, ny = -dr; const L = Math.hypot(nr, ny) || 1; nr /= L; ny /= L;
        const nx = nr * c / sx, nz = nr * s / sz, NL = Math.hypot(nx, ny, nz) || 1;
        this.lines.push(`vn ${(nx / NL).toFixed(4)} ${(ny / NL).toFixed(4)} ${(nz / NL).toFixed(4)}`);
      }
    }
    const id = (i, k) => i * P + k + 1;
    for (let i = 0; i < seg; i++) for (let k = 0; k < P - 1; k++) {
      const a = id(i, k), b = id(i + 1, k), c2 = id(i + 1, k + 1), d = id(i, k + 1);
      const f = (q) => `${base + q}/${tb + q}/${nb + q}`;
      this.lines.push(`f ${f(a)} ${f(d)} ${f(c2)} ${f(b)}`);
    }
    const count = (seg + 1) * P;
    this.nv += count; this.nt += count; this.nn += count;
  }
  save(mtl) {
    fs.writeFileSync(path.join(OUT, this.name + '.obj'), this.lines.join('\n') + '\n');
    fs.writeFileSync(path.join(OUT, this.name + '.mtl'), mtl.trim() + '\n');
    console.log('wrote', this.name, this.nv, 'vertices');
  }
}

// ---- 马桶：底座 + 椭圆形马桶圈 + 水箱 ----
{
  const o = new ObjWriter('toilet');
  o.group('bowl'); o.use('ceramic');
  o.lathe([[0.001, 0], [0.13, 0], [0.12, 0.08], [0.11, 0.2], [0.15, 0.3], [0.19, 0.38], [0.2, 0.4], [0.16, 0.405], [0.14, 0.33], [0.001, 0.3]], 28, 0, 0, 0.05, 1, 1.25);
  o.group('seat'); o.use('seat');
  o.lathe([[0.15, 0.405], [0.205, 0.405], [0.21, 0.42], [0.2, 0.43], [0.15, 0.425]], 28, 0, 0, 0.05, 1, 1.25);
  o.group('tank'); o.use('ceramic');
  o.box(0, 0.62, -0.26, 0.42, 0.42, 0.17);
  o.box(0, 0.845, -0.26, 0.44, 0.03, 0.19);
  o.use('chrome');
  o.box(0, 0.87, -0.26, 0.08, 0.015, 0.05);
  o.save(`
# 马桶材质
newmtl ceramic
Kd 0.97 0.97 0.96
Ks 0.6 0.6 0.6
Ns 200
newmtl seat
Kd 0.93 0.93 0.92
Ks 0.3 0.3 0.3
Ns 80
newmtl chrome
Kd 0.8 0.82 0.85
Ks 1 1 1
Ns 400
`);
}

// ---- 餐椅：四条腿 + 软垫座面 + 靠背（带竖条） ----
{
  const o = new ObjWriter('dining_chair');
  o.group('frame'); o.use('oak');
  for (const [x, z] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]]) o.box(x, 0.22, z, 0.04, 0.44, 0.04);
  o.box(-0.2, 0.7, -0.2, 0.04, 0.52, 0.04);
  o.box(0.2, 0.7, -0.2, 0.04, 0.52, 0.04);
  o.box(0, 0.93, -0.2, 0.44, 0.07, 0.035);
  for (const x of [-0.1, 0, 0.1]) o.box(x, 0.68, -0.2, 0.025, 0.42, 0.02);
  o.box(0, 0.44, 0, 0.46, 0.04, 0.46);
  o.group('cushion'); o.use('linen');
  o.box(0, 0.485, 0.01, 0.42, 0.05, 0.42);
  o.save(`
# 餐椅材质：橡木 + 亚麻布
newmtl oak
Kd 0.85 0.68 0.48
Ks 0.15 0.15 0.15
Ns 30
map_Kd woodGrain.png
newmtl linen
Kd 0.82 0.78 0.7
Ks 0.02 0.02 0.02
Ns 5
map_Kd fabric.png
`);
}

// ---- 花盆：陶土盆 + 土 ----
{
  const o = new ObjWriter('plant_pot');
  o.group('pot'); o.use('terracotta');
  o.lathe([[0.001, 0], [0.16, 0], [0.2, 0.3], [0.23, 0.36], [0.23, 0.4], [0.2, 0.4], [0.19, 0.34], [0.001, 0.34]], 24);
  o.group('soil'); o.use('soil');
  o.lathe([[0.001, 0.35], [0.19, 0.35]], 24);
  o.save(`
# 花盆材质
newmtl terracotta
Kd 0.72 0.42 0.3
Ks 0.05 0.05 0.05
Ns 10
newmtl soil
Kd 0.25 0.18 0.12
Ks 0 0 0
Ns 1
`);
}
