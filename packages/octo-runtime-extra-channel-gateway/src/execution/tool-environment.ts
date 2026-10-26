import type { ContextEnvsPayload } from "@mininglamp-oss/octo-runtime-protocol";
import { trimTrailingSlashes } from "../transport/api/url.js";

/** 当前连接拥有工具身份；规范 token 与兼容别名同时覆盖默认环境，不读取消息中的凭据。 */
export function octoCliEnvironment(apiUrl: string, token: string): ContextEnvsPayload {
  if (!/^bf_[A-Za-z0-9_-]+$/.test(token)) throw new Error("IM_BOT_TOKEN_INVALID");
  let url: URL;
  try {
    url = new URL(apiUrl);
  } catch {
    throw new Error("IM_API_URL_INVALID");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("IM_API_URL_INVALID");
  url.pathname = trimTrailingSlashes(url.pathname).replace(/\/api$/, "");
  return {
    env_variables: [
      { key: "OCTO_BOT_TOKEN", value: token },
      { key: "OCTO_API_BASE_URL", value: trimTrailingSlashes(url.href) },
      { key: "OCTO_TOKEN", value: token }
    ]
  };
}
