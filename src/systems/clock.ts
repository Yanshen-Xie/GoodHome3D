// 模拟时钟：时间、日期、天气和播放状态。改变时间会同步太阳、天空、光照和室外环境数据，并通知订阅者（时间栏、图表等）。
import { WEATHER } from '../scene/environment.js';
import type { Environment } from '../scene/environment.js';
import type { EnvModel } from './envModel.js';
import type { ClockState, SunState, Weather } from '../features/services.js';

export class SimulationClock implements ClockState {
  hour = 10;
  day = 172;
  weather: Weather = 'sunny';
  playing = false;
  speed = 300;
  sun!: SunState;
  /** 太阳直射强度 0~1（考虑高度角和天气） */
  sunFactor = 0;
  private readonly listeners: ((hour: number) => void)[] = [];

  constructor(private readonly env: Environment, private readonly envModel: EnvModel) {}

  setTime(hour: number): void {
    this.hour = hour;
    this.sun = this.env.set(hour, this.day, this.weather);
    this.sunFactor = Math.max(0, Math.min(1, this.sun.elevation / 25)) * WEATHER[this.weather].sun;
    this.envModel.updateOutdoor(hour, this.day, this.weather);
    for (const listener of this.listeners) listener(hour);
  }

  setDay(day: number): void {
    this.day = day;
    this.setTime(this.hour);
  }

  setWeather(weather: Weather): void {
    this.weather = weather;
    this.setTime(this.hour);
  }

  setPlaying(playing: boolean, speed?: number): void {
    this.playing = playing;
    if (speed !== undefined) this.speed = speed;
    for (const listener of this.listeners) listener(this.hour);
  }

  /** 播放时按倍速推进模拟时间 */
  advance(dt: number): void {
    if (!this.playing) return;
    let hour = this.hour + (dt * this.speed) / 3600;
    if (hour >= 24) hour -= 24;
    this.setTime(hour);
  }

  onTimeChanged(listener: (hour: number) => void): void {
    this.listeners.push(listener);
  }

  /** 当前时间，格式 HH:MM */
  format(): string {
    const h = this.hour;
    return `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`;
  }
}
