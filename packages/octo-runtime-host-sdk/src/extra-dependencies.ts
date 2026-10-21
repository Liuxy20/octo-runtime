type DependencyFunction = (...args: unknown[]) => unknown;

/** 同进程只读浅快照；保留原型成员，函数始终以宿主原对象为 this，不冻结宿主状态。 */
export function snapshotExtraDependencies<D extends object>(
  source: Readonly<D>,
  wrap: (invoke: DependencyFunction) => DependencyFunction = (invoke) => invoke
): Readonly<D> {
  const snapshot = Object.create(Object.getPrototypeOf(source) as object | null) as object;
  const seen = new Set<PropertyKey>();
  for (
    let current: object | null = source;
    current && current !== Object.prototype;
    current = Object.getPrototypeOf(current) as object | null
  ) {
    for (const key of Reflect.ownKeys(current)) {
      if (seen.has(key) || (key === "constructor" && current !== source)) continue;
      seen.add(key);
      // 值与访问器结果沿用浅快照语义；方法绑定原实例，才能访问其私有字段。
      const value: unknown = Reflect.get(source, key, source);
      Object.defineProperty(snapshot, key, {
        value:
          typeof value === "function"
            ? wrap((...args) => Reflect.apply(value, source, args))
            : value,
        enumerable: Reflect.getOwnPropertyDescriptor(current, key)!.enumerable
      });
    }
  }
  return Object.freeze(snapshot) as Readonly<D>;
}
