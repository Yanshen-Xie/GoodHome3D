// 统一更新调度：主循环只调用 tick(dt)。各子系统按登记顺序逐帧更新，慢任务（环境模拟、图表刷新等）每隔
// slowInterval 秒运行一次，参数是距上次运行累计的时间。每个任务单独捕获异常，一个功能出错不影响其他功能和渲染。
export type UpdateTask = (dt: number) => void;

interface Task {
  readonly name: string;
  readonly run: UpdateTask;
}

export class FrameScheduler {
  private readonly frameTasks: Task[] = [];
  private readonly slowTasks: Task[] = [];
  private slowElapsed = 0;
  private readonly failed = new Set<string>();

  constructor(private readonly slowInterval = 0.5) {}

  /** 登记逐帧任务，返回取消登记的函数 */
  every(name: string, run: UpdateTask): () => void {
    return this.add(this.frameTasks, { name, run });
  }

  /** 登记慢任务（每 slowInterval 秒一次），返回取消登记的函数 */
  slow(name: string, run: UpdateTask): () => void {
    return this.add(this.slowTasks, { name, run });
  }

  tick(dt: number): void {
    this.runAll(this.frameTasks, dt);
    this.slowElapsed += dt;
    if (this.slowElapsed > this.slowInterval) {
      const elapsed = this.slowElapsed;
      this.slowElapsed = 0;
      this.runAll(this.slowTasks, elapsed);
    }
  }

  /** 已登记任务的名称，按执行顺序 */
  taskNames(): { frame: string[]; slow: string[] } {
    return { frame: this.frameTasks.map((t) => t.name), slow: this.slowTasks.map((t) => t.name) };
  }

  clear(): void {
    this.frameTasks.length = 0;
    this.slowTasks.length = 0;
  }

  private add(list: Task[], task: Task): () => void {
    list.push(task);
    return () => {
      const i = list.indexOf(task);
      if (i >= 0) list.splice(i, 1);
    };
  }

  private runAll(list: readonly Task[], dt: number): void {
    for (const task of [...list]) {
      try {
        task.run(dt);
      } catch (e) {
        // 同一个任务连续出错时只完整打印第一次，避免每帧刷屏
        if (!this.failed.has(task.name)) { this.failed.add(task.name); console.error(`更新任务「${task.name}」出错：`, e); }
        continue;
      }
      this.failed.delete(task.name);
    }
  }
}
