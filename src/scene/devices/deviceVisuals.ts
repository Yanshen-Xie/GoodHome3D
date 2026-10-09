import * as THREE from 'three';
import { uniqueMat } from '../common.js';
export const STATUS_COLOR = { normal: 0x2ecc71, warning: 0xf1c40f, fault: 0xe74c3c, off: 0x7f8c8d } as const;
export const STATUS_TEXT = { normal: '正常', warning: '预警', fault: '故障', off: '关闭' } as const;
export function kelvinToColor(k: number): THREE.Color {
  const t = k / 100;
  let r: number, g: number, b: number;
  if (t <= 66) { r = 255; g = 99.47 * Math.log(t) - 161.12; } else { r = 329.7 * Math.pow(t - 60, -0.1332); g = 288.12 * Math.pow(t - 60, -0.0755); }
  if (t >= 66) b = 255; else if (t <= 19) b = 0; else b = 138.52 * Math.log(t - 10) - 305.04;
  const c = (v: number) => Math.min(255, Math.max(0, v)) / 255;
  return new THREE.Color(c(r), c(g), c(b));
}
export function statusLed(r = 0.025): THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial> {
  return new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), uniqueMat({ color: 0x111111, emissive: STATUS_COLOR.normal, emissiveIntensity: 2 }));
}
