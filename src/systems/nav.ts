// 导航网格 + A* 寻路。
// 把地面划分成 0.2m × 0.2m 的格子，墙和家具所在的格子标记为"不可通行"。
// 用途：人物日常走动的路线、火灾时的疏散路线、漫游模式下的碰撞检测。
/** 平面上的点 */
export interface XZ { x: number; z: number }
/** 带高度的路点（跨楼层路线上的点都带 y） */
export interface NavPoint extends XZ { y: number }
/** 某一层上的点；floor 省略时为一层 */
export interface FloorPoint extends XZ { floor?: number }
export interface PathOptions { avoidDanger?: boolean; radius?: number }
/** 平面矩形范围（米） */
export interface FootprintRect { x0: number; x1: number; z0: number; z1: number }

export class NavGrid {
  // Fields are declared here and initialized by the existing runtime flow.
  declare blocked: any;
  declare staticBlocked: Uint8Array;
  declare footprintCount: Uint16Array;
  declare cell: any;
  declare clearance: any;
  declare clearanceCache: any;
  declare danger: any;
  declare nx: any;
  declare nz: any;
  declare x0: any;
  declare z0: any;

  constructor(x0 = -13, x1 = 13, z0 = -10, z1 = 10, cell = 0.2) {
    this.x0 = x0; this.z0 = z0; this.cell = cell;
    this.nx = Math.round((x1 - x0) / cell);
    this.nz = Math.round((z1 - z0) / cell);
    this.blocked = new Uint8Array(this.nx * this.nz);   // 墙、家具（= 固定障碍 或 至少一个占地）
    this.staticBlocked = new Uint8Array(this.nx * this.nz); // 墙体、围栏等固定障碍
    this.footprintCount = new Uint16Array(this.nx * this.nz); // 每格被多少个模块占地覆盖
    this.danger = new Uint8Array(this.nx * this.nz);    // 危险区域（火源附近），疏散时要绕开
    this.clearance = null;                               // 障碍物外扩后的结果（人有宽度）
    this.clearanceCache = {};                            // 不同外扩半径（格数）的结果
  }

  ix(x) { return Math.floor((x - this.x0) / this.cell); }
  iz(z) { return Math.floor((z - this.z0) / this.cell); }
  cx(i) { return this.x0 + (i + 0.5) * this.cell; }
  cz(j) { return this.z0 + (j + 0.5) * this.cell; }
  idx(i, j) { return j * this.nx + i; }
  inside(i, j) { return i >= 0 && j >= 0 && i < this.nx && j < this.nz; }

  /** 矩形覆盖的每个格子 */
  private forCells(x0: number, x1: number, z0: number, z1: number, fn: (k: number) => void) {
    for (let j = this.iz(z0); j <= this.iz(z1 - 1e-6); j++)
      for (let i = this.ix(x0); i <= this.ix(x1 - 1e-6); i++)
        if (this.inside(i, j)) fn(this.idx(i, j));
  }

  private invalidate() {
    this.clearance = null;
    this.clearanceCache = {};
  }

  /** 把矩形区域标记为固定障碍（墙体、围栏等，不会再移除） */
  blockRect(x0, x1, z0, z1) {
    this.forCells(x0, x1, z0, z1, (k) => { this.staticBlocked[k] = 1; this.blocked[k] = 1; });
    this.invalidate();
  }

  /** 增加（delta = 1）或撤销（delta = -1）一块可移除的占地 */
  applyFootprint(rect: FootprintRect, delta: 1 | -1) {
    this.forCells(rect.x0, rect.x1, rect.z0, rect.z1, (k) => {
      this.footprintCount[k] = Math.max(0, this.footprintCount[k] + delta);
      this.blocked[k] = this.staticBlocked[k] || this.footprintCount[k] > 0 ? 1 : 0;
    });
    this.invalidate();
  }

  /** 设置危险区域：以 (x,z) 为圆心、半径 r 的圆 */
  setDanger(x, z, r) {
    this.danger.fill(0);
    if (r <= 0) return;
    for (let j = this.iz(z - r); j <= this.iz(z + r); j++)
      for (let i = this.ix(x - r); i <= this.ix(x + r); i++)
        if (this.inside(i, j) && (this.cx(i) - x) ** 2 + (this.cz(j) - z) ** 2 <= r * r) this.danger[this.idx(i, j)] = 1;
  }

  /**
   * 障碍物向外扩 r 格：人的肩宽约 0.4m，路线中心至少离墙 0.2m（1 格）；轮椅更宽，需要外扩更多。
   */
  buildClearance(r = 1) {
    if (this.clearanceCache[r]) { this.clearance = this.clearanceCache[r]; return this.clearance; }
    const c = new Uint8Array(this.blocked);
    for (let j = 0; j < this.nz; j++) for (let i = 0; i < this.nx; i++) {
      if (!this.blocked[this.idx(i, j)]) continue;
      for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++)
        if (this.inside(i + di, j + dj)) c[this.idx(i + di, j + dj)] = 1;
    }
    this.clearanceCache[r] = c;
    this.clearance = c;
    return c;
  }

  /**
   * 通行宽度：从 (x,z) 出发，沿垂直于行进方向 (dx,dz) 的左右两侧各走到第一个障碍，两段距离之和。
   */
  passWidth(x, z, dx, dz, max = 3) {
    const L = Math.hypot(dx, dz) || 1;
    const nx = -dz / L, nz = dx / L;
    const reach = (s) => {
      for (let d = 0; d <= max; d += this.cell / 4) if (!this.isFree(x + nx * d * s, z + nz * d * s)) return d;
      return max;
    };
    return reach(1) + reach(-1);
  }

  /** (x,z) 是否可以站人（漫游碰撞用，只看原始障碍） */
  isFree(x, z) {
    const i = this.ix(x), j = this.iz(z);
    return this.inside(i, j) && !this.blocked[this.idx(i, j)];
  }

  walkable(i, j, avoidDanger) {
    if (!this.inside(i, j)) return false;
    const k = this.idx(i, j);
    if (this.clearance[k]) return false;
    if (avoidDanger && this.danger[k]) return false;
    return true;
  }

  /** 找离 (x,z) 最近的可通行格子（起点或终点恰好落在家具边上时用） */
  nearestWalkable(x, z, avoidDanger) {
    const i0 = this.ix(x), j0 = this.iz(z);
    for (let r = 0; r < 15; r++)
      for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        if (this.walkable(i0 + di, j0 + dj, avoidDanger)) return [i0 + di, j0 + dj];
      }
    return null;
  }

  /**
   * A* 寻路：g = 已走距离，h = 到终点的直线距离（启发函数），每次展开 f = g + h 最小的格子。
   * 8 邻域移动，斜向代价 √2；斜穿墙角时要求两个相邻直行格子都可通行。
   * 返回世界坐标点数组 [{x,z}]，找不到返回 null。
   */
  findPath(sx: number, sz: number, tx: number, tz: number, { avoidDanger = false, radius = 1 }: PathOptions = {}): XZ[] | null {
    this.buildClearance(radius);
    const s = this.nearestWalkable(sx, sz, avoidDanger), t = this.nearestWalkable(tx, tz, avoidDanger);
    if (!s || !t) return null;
    const N = this.nx * this.nz;
    const g = new Float32Array(N).fill(Infinity);
    const from = new Int32Array(N).fill(-1);
    const closed = new Uint8Array(N);
    const heap = new MinHeap();
    const start = this.idx(s[0], s[1]), goal = this.idx(t[0], t[1]);
    const h = (i, j) => Math.hypot(i - t[0], j - t[1]);
    g[start] = 0;
    heap.push(start, h(s[0], s[1]));
    const dirs = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
    while (heap.size) {
      const cur = heap.pop();
      if (cur === goal) break;
      if (closed[cur]) continue;
      closed[cur] = 1;
      const ci = cur % this.nx, cj = (cur / this.nx) | 0;
      for (const [di, dj, cost] of dirs) {
        const ni = ci + di, nj = cj + dj;
        if (!this.walkable(ni, nj, avoidDanger)) continue;
        if (di && dj && (!this.walkable(ci + di, cj, avoidDanger) || !this.walkable(ci, cj + dj, avoidDanger))) continue;
        const k = this.idx(ni, nj);
        const ng = g[cur] + cost;
        if (ng < g[k]) { g[k] = ng; from[k] = cur; heap.push(k, ng + h(ni, nj)); }
      }
    }
    if (from[goal] === -1 && goal !== start) return null;
    const cells: number[] = [];
    for (let k = goal; k !== -1; k = from[k]) cells.push(k);
    cells.reverse();
    const pts = cells.map((k) => ({ x: this.cx(k % this.nx), z: this.cz((k / this.nx) | 0) }));
    return this.smooth(pts, avoidDanger);
  }

  /** 路径平滑：能直线走到的点之间去掉中间的拐点（视线检查） */
  smooth(pts: XZ[], avoidDanger: boolean): XZ[] {
    if (pts.length < 3) return pts;
    const out = [pts[0]];
    let a = 0;
    while (a < pts.length - 1) {
      let b = pts.length - 1;
      while (b > a + 1 && !this.lineFree(pts[a], pts[b], avoidDanger)) b--;
      out.push(pts[b]);
      a = b;
    }
    return out;
  }

  lineFree(p, q, avoidDanger) {
    const d = Math.hypot(q.x - p.x, q.z - p.z);
    const n = Math.ceil(d / (this.cell * 0.5));
    for (let k = 0; k <= n; k++) {
      const x = p.x + (q.x - p.x) * k / n, z = p.z + (q.z - p.z) * k / n;
      if (!this.walkable(this.ix(x), this.iz(z), avoidDanger)) return false;
    }
    return true;
  }
}

/** 二叉堆（小根堆），A* 用来快速取出 f 值最小的格子 */
class MinHeap {
  // Fields are declared here and initialized by the existing runtime flow.
  declare k: any;
  declare v: any;

  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(key, val) {
    const k = this.k, v = this.v;
    k.push(key); v.push(val);
    let i = k.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (v[p] <= v[i]) break;
      [k[p], k[i]] = [k[i], k[p]]; [v[p], v[i]] = [v[i], v[p]];
      i = p;
    }
  }
  pop() {
    const k = this.k, v = this.v;
    const top = k[0];
    const lk = k.pop(), lv = v.pop();
    if (k.length) {
      k[0] = lk; v[0] = lv;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < k.length && v[l] < v[m]) m = l;
        if (r < k.length && v[r] < v[m]) m = r;
        if (m === i) break;
        [k[m], k[i]] = [k[i], k[m]]; [v[m], v[i]] = [v[i], v[m]];
        i = m;
      }
    }
    return top;
  }
}

/**
 * 两层住宅的导航：每层一个导航网格，跨楼层时把路线拼接起来：
 *   本层起点 → 楼梯口（本层 A* 路线）→ 楼梯上的三维路点 → 另一层楼梯口 → 终点（另一层 A* 路线）
 * 返回的路点都带有高度 y，人物沿路点移动时就能自然地上下楼。
 */
export class NavWorld {
  // Fields are declared here and initialized by the existing runtime flow.
  declare floorY: any;
  declare grids: any;
  declare stair: any;

  constructor(stair, floorY) {
    this.grids = [new NavGrid(), new NavGrid()];
    this.stair = stair;       // layout.js 中的 STAIR（含上楼路点 path）
    this.floorY = floorY;     // 各层地面高度
  }

  grid(floor = 0) { return this.grids[floor]; }
  blockRect(floor, x0, x1, z0, z1) { this.grids[floor].blockRect(x0, x1, z0, z1); }
  isFree(x, z, floor = 0) { return this.grids[floor].isFree(x, z); }
  passWidth(x, z, dx, dz, floor = 0) { return this.grids[floor].passWidth(x, z, dx, dz); }
  setDanger(x, z, r, floor = 0) { this.grids.forEach((g, i) => g.setDanger(x, z, i === floor ? r : 0)); }
  applyFootprint(floor: number, rect: FootprintRect, delta: 1 | -1) { this.grids[floor].applyFootprint(rect, delta); }
  buildClearance() { this.grids.forEach((g) => g.buildClearance()); }

  /**
   * a、b: { x, z, floor }。opts 同 NavGrid.findPath（avoidDanger、radius）
   * 返回 [{x, y, z}]，找不到返回 null
   */
  findPath(a: FloorPoint, b: FloorPoint, opts: PathOptions = {}): NavPoint[] | null {
    const fa = a.floor ?? 0, fb = b.floor ?? 0;
    const lift = (pts: XZ[], f: number): NavPoint[] => pts.map((p) => ({ x: p.x, y: this.floorY[f], z: p.z }));
    if (fa === fb) {
      const p = this.grids[fa].findPath(a.x, a.z, b.x, b.z, opts);
      return p ? lift(p, fa) : null;
    }
    const up = fb > fa;
    const sp = up ? this.stair.path : [...this.stair.path].reverse();
    const enter = sp[0], leave = sp[sp.length - 1];
    const p1 = this.grids[fa].findPath(a.x, a.z, enter.x, enter.z, opts);
    const p2 = this.grids[fb].findPath(leave.x, leave.z, b.x, b.z, opts);
    if (!p1 || !p2) return null;
    return [...lift(p1, fa), ...sp.map((p) => ({ ...p })), ...lift(p2, fb)];
  }
}

/** 一块登记在导航网格上的占地 */
export interface FootprintEntry {
  readonly id: string;
  readonly floor: number;
  readonly rect: FootprintRect;
}

/**
 * 可移除的导航占地：家具等模块按 ID 登记占地，放置时登记、移动时更新、移除时撤销。
 * 同一格可以被多块占地覆盖，撤销一块不会误清掉别的占地或墙体。
 */
export class FootprintService {
  private readonly entries = new Map<string, FootprintEntry>();

  constructor(private readonly nav: NavWorld) {}

  register(id: string, floor: number, rect: FootprintRect): void {
    if (this.entries.has(id)) throw new Error('导航占地已登记：' + id);
    if (!(rect.x1 > rect.x0 && rect.z1 > rect.z0)) throw new Error('导航占地范围无效：' + id);
    const entry = { id, floor, rect: { ...rect } };
    this.entries.set(id, entry);
    this.nav.applyFootprint(floor, entry.rect, 1);
  }

  /** 撤销占地；没有登记过时返回 false */
  unregister(id: string): boolean {
    const entry = this.entries.get(id);
    if (!entry) return false;
    this.entries.delete(id);
    this.nav.applyFootprint(entry.floor, entry.rect, -1);
    return true;
  }

  /** 模块移动后更新占地：先撤销旧的，再登记新的 */
  move(id: string, floor: number, rect: FootprintRect): void {
    this.unregister(id);
    this.register(id, floor, rect);
  }

  get(id: string): FootprintEntry | undefined { return this.entries.get(id); }
  list(): readonly FootprintEntry[] { return [...this.entries.values()]; }
}
