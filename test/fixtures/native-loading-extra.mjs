export const name = "selected-extra";
/** 只持有自己的清理回调；借用宿主函数，不接管宿主资源。 */
export default function extra(context) {
  return async (dependencies) => {
    context.onStatus(() => ({ value: dependencies.readValue(), pid: process.pid }));
    context.onDispose(() => dependencies.released());
  };
}
