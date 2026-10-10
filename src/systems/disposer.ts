// 资源回收：登记事件监听、定时器和清理函数，dispose() 时按登记的相反顺序全部撤销。
export class Disposer {
  private readonly cleanups: (() => void)[] = [];
  private disposed = false;

  /** 登记一个清理函数 */
  add(cleanup: () => void): void {
    if (this.disposed) { cleanup(); return; }
    this.cleanups.push(cleanup);
  }

  /** 添加事件监听，并在 dispose 时移除 */
  listen<K extends keyof WindowEventMap>(target: Window, type: K, handler: (event: WindowEventMap[K]) => void, options?: AddEventListenerOptions): void;
  listen<K extends keyof HTMLElementEventMap>(target: HTMLElement, type: K, handler: (event: HTMLElementEventMap[K]) => void, options?: AddEventListenerOptions): void;
  listen(target: EventTarget, type: string, handler: (event: any) => void, options?: AddEventListenerOptions): void {
    target.addEventListener(type, handler, options);
    this.add(() => target.removeEventListener(type, handler, options));
  }

  /** 延时执行；dispose 后不会再触发 */
  later(fn: () => void, ms: number): void {
    if (this.disposed) return;
    const id = setTimeout(() => {
      const i = this.cleanups.indexOf(cancel);
      if (i >= 0) this.cleanups.splice(i, 1);
      fn();
    }, ms);
    const cancel = () => clearTimeout(id);
    this.cleanups.push(cancel);
  }

  get isDisposed(): boolean { return this.disposed; }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    while (this.cleanups.length) {
      const cleanup = this.cleanups.pop()!;
      try { cleanup(); } catch (e) { console.error('释放资源时出错：', e); }
    }
  }
}
