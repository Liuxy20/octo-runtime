import type {
  AsyncUserInputQuestion,
  QuestionRequest,
  QuestionResponse
} from "./generated/protocol-types.js";
import { assertJsonValue } from "./context.js";

const invalidResponse = () =>
  Object.assign(new TypeError("INVALID_QUESTION_RESPONSE"), { code: "INVALID_QUESTION_RESPONSE" });

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0 && Array.from(value).length <= 4096;
const fields = (value: Record<string, unknown>, allowed: string[]): boolean =>
  Object.keys(value).every((key) => allowed.includes(key));

/** 校验公开问题快照；不裁剪选项或把损坏的表单降为普通文字。 */
export function assertAsyncQuestions(value: unknown): asserts value is AsyncUserInputQuestion[] {
  assertJsonValue(value);
  if (
    !Array.isArray(value) ||
    value.length > 50 ||
    value.some(
      (question) =>
        !record(question) ||
        !fields(question, ["title", "options"]) ||
        !text(question.title) ||
        !(
          question.options === null ||
          (Array.isArray(question.options) &&
            question.options.length <= 50 &&
            question.options.every(text))
        )
    )
  )
    throw new TypeError("INVALID_ASYNC_QUESTIONS");
}

/** 异步表单由交互事件授权回答；消息快照本身不代表仍有活动轮次。 */
export function assertQuestionRequest(value: unknown): asserts value is QuestionRequest {
  assertJsonValue(value);
  if (
    !record(value) ||
    !fields(value, ["schema", "messageId", "questions"]) ||
    value.schema !== "octo.question-request/v1" ||
    typeof value.messageId !== "string" ||
    !value.messageId ||
    !Array.isArray(value.questions) ||
    !value.questions.length ||
    value.questions.length > 50
  )
    throw new TypeError("INVALID_QUESTION_REQUEST");
  for (const [index, q] of value.questions.entries()) {
    if (
      !record(q) ||
      !fields(q, ["id", "title", "options", "allowCustom"]) ||
      q.id !== `q:${index}` ||
      q.allowCustom !== true
    )
      throw new TypeError("INVALID_QUESTION_REQUEST");
    assertAsyncQuestions([{ title: q.title, options: q.options }]);
  }
}

/** 只校验响应形状；题目归属、漏题和排序由持有原始表单的 Adapter 核对。 */
export function assertQuestionResponse(value: unknown): asserts value is QuestionResponse {
  try {
    assertJsonValue(value);
  } catch {
    throw invalidResponse();
  }
  if (
    !record(value) ||
    !fields(value, ["schema", "answers"]) ||
    value.schema !== "octo.question-response/v1" ||
    !Array.isArray(value.answers) ||
    !value.answers.length ||
    value.answers.length > 50
  )
    throw invalidResponse();
  const ids = new Set<string>();
  for (const answer of value.answers) {
    if (
      !record(answer) ||
      !fields(answer, ["questionId", "text"]) ||
      typeof answer.questionId !== "string" ||
      !/^q:(0|[1-9][0-9]?)$/.test(answer.questionId) ||
      ids.has(answer.questionId) ||
      !text(answer.text)
    )
      throw invalidResponse();
    ids.add(answer.questionId);
  }
}

/** 两条补充路径使用同一原题关联；只校验并编码数据，不解析正文或执行模板。 */
export function questionAnswerText(request: QuestionRequest, value: unknown): string {
  assertQuestionRequest(request);
  assertQuestionResponse(value);
  if (
    value.answers.length !== request.questions.length ||
    value.answers.some((answer) => !request.questions.some((q) => q.id === answer.questionId))
  )
    throw invalidResponse();
  return (
    "Answer to async user questions:\n" +
    JSON.stringify({
      messageId: request.messageId,
      answers: request.questions.map((q) => ({
        questionId: q.id,
        title: q.title,
        text: value.answers.find((a) => a.questionId === q.id)!.text
      }))
    })
  );
}
