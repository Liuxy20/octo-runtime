// 仅由显式专项宿主 import，提供生产 Adapter 给原生 Kernel。
import { createOpenClawAdapter } from "@mininglamp-oss/octo-runtime-adapter-openclaw";

export const adapters = [createOpenClawAdapter()];
