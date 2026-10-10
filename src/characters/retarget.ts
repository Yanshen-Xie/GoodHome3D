// 动画重定向：把一个角色（源）的骨骼动画"搬"到另一个骨骼结构相同、但初始姿态和尺寸不同的角色（目标）上。
//
// 思路（世界空间旋转差）：
//   两个角色都先摆成 T-Pose（标准站姿）。对每一根骨骼，
//   源角色在第 t 帧相对 T-Pose 的世界旋转变化量  Δ = Q源(t) · Q源(T)^-1
//   把同样的变化量加到目标骨骼的 T-Pose 世界旋转上  Q目标(t) = Δ · Q目标(T)
//   再换算回相对父骨骼的局部旋转                    q局部 = Q父(t)^-1 · Q目标(t)
//   按父→子的顺序算完所有骨骼，就得到目标角色每一帧的姿态，最后生成新的动画片段。
import * as THREE from 'three';

function bonesOf(root) {
  const map = new Map();
  root.traverse((o) => { if (o.isBone) map.set(o.name, o); });
  return map;
}

// 把某个动画片段的第 time 秒姿态应用到模型上。
// 每个模型只用一个 mixer：动作一旦 stop，three.js 会把骨骼恢复成原始姿态，所以这里不在读取姿态之前停止它。
const mixers = new WeakMap();
function applyPose(root, clip, time) {
  let m = mixers.get(root);
  if (!m) { m = { mixer: new THREE.AnimationMixer(root), action: null }; mixers.set(root, m); }
  const action = m.mixer.clipAction(clip);
  if (m.action !== action) {
    if (m.action) m.action.stop();
    action.play();
    m.action = action;
  }
  m.mixer.setTime(time);
  root.updateMatrixWorld(true);
}

function worldQuat(obj) {
  return obj.getWorldQuaternion(new THREE.Quaternion());
}

/**
 * @param src        源角色（GLTF 的 scene）
 * @param srcClip    要搬运的动画（如 Walk）
 * @param srcTPose   源角色的 T-Pose 片段
 * @param tgt        目标角色
 * @param tgtTPose   目标角色的 T-Pose 片段
 * @param yawOffset  两个模型朝向相差的角度（绕 Y 轴，弧度）
 * @param fps        采样帧率
 */
export function retargetClip(src, srcClip, srcTPose, tgt, tgtTPose, yawOffset = 0, fps = 30) {
  const srcBones = bonesOf(src);
  const tgtBones = bonesOf(tgt);
  // 目标骨骼按"父在前、子在后"的顺序排列（traverse 本身就是先序遍历）
  const order: THREE.Bone[] = [];
  tgt.traverse((o: THREE.Object3D) => { if ((o as THREE.Bone).isBone && srcBones.has(o.name)) order.push(o as THREE.Bone); });

  // 1. 记录两个角色 T-Pose 时每根骨骼的世界旋转
  applyPose(src, srcTPose, 0);
  const srcRest = new Map<string, THREE.Quaternion>();
  for (const [name, b] of srcBones) srcRest.set(name, worldQuat(b));
  const srcHips = srcBones.get('mixamorigHips');
  const srcHipsRestY = srcHips.getWorldPosition(new THREE.Vector3()).y;

  applyPose(tgt, tgtTPose, 0);
  const tgtRest = new Map<string, THREE.Quaternion>();
  for (const b of order) tgtRest.set(b.name, worldQuat(b));
  const tgtHips = tgtBones.get('mixamorigHips');
  const tgtHipsRestWorld = tgtHips.getWorldPosition(new THREE.Vector3());
  const heightRatio = tgtHipsRestWorld.y / srcHipsRestY; // 两个角色身高不同，胯部起伏按比例缩放
  const tgtHipsParentWorld = tgtHips.parent.matrixWorld.clone(); // 胯部的父节点不参与动画，矩阵不变

  // 源和目标朝向不同时，用这个旋转把"源的变化量"转到目标的朝向下
  const R = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yawOffset);
  const Rinv = R.clone().invert();

  // 2. 逐帧计算
  const frames = Math.max(2, Math.round(srcClip.duration * fps) + 1);
  const times: number[] = [];
  const quatValues = new Map<string, number[]>(order.map((b) => [b.name, []]));
  const hipsPos: number[] = [];
  const newWorld = new Map<string, THREE.Quaternion>();

  for (let f = 0; f < frames; f++) {
    const t = Math.min(srcClip.duration, f / fps);
    times.push(t);
    applyPose(src, srcClip, t);
    newWorld.clear();
    for (const b of order) {
      const delta = worldQuat(srcBones.get(b.name)!).multiply(srcRest.get(b.name)!.clone().invert());
      delta.premultiply(R).multiply(Rinv);
      const wq = delta.multiply(tgtRest.get(b.name)!);
      newWorld.set(b.name, wq);
      // 父骨骼的新世界旋转：如果父节点也是被驱动的骨骼就用刚算出的值，否则用它当前（不变）的世界旋转
      const parent = b.parent!;
      const parentQ = newWorld.get(parent.name) ?? worldQuat(parent);
      const local = parentQ.clone().invert().multiply(wq);
      quatValues.get(b.name)!.push(local.x, local.y, local.z, local.w);
    }
    // 胯部上下起伏
    const dy = (srcHips.getWorldPosition(new THREE.Vector3()).y - srcHipsRestY) * heightRatio;
    const p = tgtHipsRestWorld.clone();
    p.y += dy;
    p.applyMatrix4(tgtHipsParentWorld.clone().invert());
    hipsPos.push(p.x, p.y, p.z);
  }

  const tracks = order.map((b) => new THREE.QuaternionKeyframeTrack(`${b.name}.quaternion`, times, quatValues.get(b.name)!));
  tracks.push(new THREE.VectorKeyframeTrack('mixamorigHips.position', times, hipsPos));
  applyPose(tgt, tgtTPose, 0);
  return new THREE.AnimationClip(srcClip.name, srcClip.duration, tracks);
}
