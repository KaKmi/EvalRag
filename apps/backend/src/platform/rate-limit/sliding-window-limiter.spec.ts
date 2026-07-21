import { SlidingWindowLimiter } from "./sliding-window-limiter";

/**
 * 这个类存在的**理由**是「两份逐字同构的实现只修了一份」，所以本文件的重心是那个漏——
 * 过期键必须被清掉。仓库里有一条调用路径（自动回验）每次用全新的一次性键，
 * 不清的话表只增不减。
 */
describe("SlidingWindowLimiter", () => {
  const WINDOW = 60_000;

  it("窗口内同一个键被拦下，窗口外放行", () => {
    const limiter = new SlidingWindowLimiter(WINDOW);
    limiter.record("k", 0);

    expect(limiter.isLimited("k", 59_999)).toBe(true);
    expect(limiter.isLimited("k", 60_000)).toBe(false);
  });

  it("没记过的键一律放行", () => {
    const limiter = new SlidingWindowLimiter(WINDOW);
    expect(limiter.isLimited("never-seen", 0)).toBe(false);
  });

  it("`isLimited` **只读**——查不该占用配额", () => {
    // 两个方法分开的意义就在这：evaluations 有一条「失败重试放行」的旁路，
    // 它跳过检查但仍要记时间。若 isLimited 顺手写入，那条旁路会被自己刚才的查询拦住。
    const limiter = new SlidingWindowLimiter(WINDOW);

    limiter.isLimited("k", 0);
    limiter.isLimited("k", 1);

    expect(limiter.size).toBe(0);
  });

  it("⛔ record 清掉已过期的键——一次性键不会让表无限增长", () => {
    // 这是本类存在的理由。自动回验每次合成一个全新的 trace id 绕开限频，
    // 那些键保证不会被第二次读到；不清的话长期运行的进程里这张表只增不减。
    const limiter = new SlidingWindowLimiter(WINDOW);

    for (let i = 0; i < 100; i += 1) {
      limiter.record(`one-shot-${i}`, i * WINDOW);
    }

    // 每个键都比下一个早整整一个窗口 ⇒ 记到最后一个时，前面的全过期了。
    expect(limiter.size).toBe(1);
  });

  it("未过期的键不会被误清", () => {
    // 与上一条配对：一个「每次 record 都清空整张表」的实现也能让上面那条通过，
    // 但它会让限频彻底失效。
    const limiter = new SlidingWindowLimiter(WINDOW);

    limiter.record("a", 0);
    limiter.record("b", 1_000);

    expect(limiter.size).toBe(2);
    expect(limiter.isLimited("a", 2_000)).toBe(true);
  });
});
