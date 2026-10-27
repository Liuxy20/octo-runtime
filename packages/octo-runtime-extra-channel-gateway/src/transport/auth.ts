import { connectionFetch, connectionJson, httpConnectionFailure } from "./connection-error.js";
import { trimTrailingSlashes } from "./api/url.js";

/** 建联前用调用方提供的 Bot 凭据解析身份与租户；取消由调用方持有，不跟随重定向转发凭据。 */
export async function verifyBotIdentity(
  apiUrl: string,
  token: string,
  signal: AbortSignal
): Promise<{ bot_uid: string; space_id: string }> {
  const response = await connectionFetch(
    `${trimTrailingSlashes(apiUrl)}/v1/auth/verify-bot`,
    {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bot_token: token })
    },
    "AUTH"
  );
  if (!response.ok) {
    throw await httpConnectionFailure(response, "AUTH");
  }
  const data = (await connectionJson(response, "AUTH", "IM_AUTH_IDENTITY_INVALID")) as {
    bot_uid?: unknown;
    space_id?: unknown;
  };
  if (
    !data ||
    typeof data.bot_uid !== "string" ||
    !data.bot_uid ||
    typeof data.space_id !== "string" ||
    !data.space_id
  )
    throw new Error("IM_AUTH_IDENTITY_INVALID");
  return { bot_uid: data.bot_uid, space_id: data.space_id };
}
