import type { ButtonSnapshot, DetectionResult, NormalizedTarget } from "./types.js";

const BLOCKED_PATTERNS = [
  /请先登录/,
  /登录后/,
  /扫码登录/,
  /账号登录/,
  /安全验证/,
  /人机验证/,
  /验证码/,
  /访问受限/,
  /风控/,
  /操作过于频繁/,
  /系统繁忙/,
  /网络繁忙/
];

const REGION_BLOCK_PATTERNS = [
  /仅限中国大陆/,
  /非大陆/,
  /地区限制/,
  /当前地区不可用/,
  /所在地区/,
  /IP.*限制/i
];

const SOLD_OUT_PATTERNS = [
  /已售罄/,
  /售罄/,
  /缺货登记/,
  /暂无票/,
  /暂无库存/,
  /不可售/,
  /已结束/,
  /已下架/,
  /暂未开售/,
  /即将开售/
];

export const AVAILABLE_BUTTON_PATTERNS = [
  /立即购买/,
  /立即购票/,
  /去购买/,
  /去购票/,
  /立即抢票/,
  /选座购买/,
  /预约购买/
];

const AVAILABLE_TEXT_PATTERNS = [
  /有票/,
  /可购买/,
  /开售中/,
  /销售中/,
  /正在售卖/
];

export const FORBIDDEN_ORDER_ACTION_PATTERNS = [
  /提交订单/,
  /确认订单/,
  /确认提交/,
  /下一步支付/,
  /立即支付/,
  /去支付/,
  /付款/,
  /支付二维码/,
  /生成二维码/
];

export function detectAvailabilityFromText(
  visibleText: string,
  buttons: ButtonSnapshot[] = [],
  target?: Pick<NormalizedTarget, "keywords">
): DetectionResult {
  const text = normalizeText(visibleText);
  const forbiddenButton = firstMatchingButton(buttons, FORBIDDEN_ORDER_ACTION_PATTERNS, false);
  if (forbiddenButton) {
    return {
      state: "blocked",
      reason: "Order or payment action is visible; manual handoff required.",
      matchedText: forbiddenButton.text
    };
  }

  const missingKeyword = firstMissingKeyword(text, target?.keywords ?? []);
  if (missingKeyword) {
    return {
      state: "unknown",
      reason: `Target keyword not visible: ${missingKeyword}`,
      matchedText: missingKeyword
    };
  }

  const regionBlocked = firstMatchingPattern(text, REGION_BLOCK_PATTERNS);
  if (regionBlocked) {
    return {
      state: "blocked",
      reason: "Region or IP restriction detected.",
      matchedText: regionBlocked
    };
  }

  const blocked = firstMatchingPattern(text, BLOCKED_PATTERNS);
  if (blocked) {
    return {
      state: "blocked",
      reason: "Login, captcha, or platform risk-control prompt detected.",
      matchedText: blocked
    };
  }

  const availableButton = firstMatchingButton(buttons, AVAILABLE_BUTTON_PATTERNS, false);
  if (availableButton) {
    return {
      state: "available",
      reason: "Enabled purchase button detected.",
      matchedText: availableButton.text
    };
  }

  const soldOut = firstMatchingPattern(text, SOLD_OUT_PATTERNS);
  if (soldOut) {
    return {
      state: "sold_out",
      reason: "Sold-out or unavailable text detected.",
      matchedText: soldOut
    };
  }

  const availableText = firstMatchingPattern(text, AVAILABLE_TEXT_PATTERNS);
  if (availableText) {
    return {
      state: "available",
      reason: "Availability text detected.",
      matchedText: availableText
    };
  }

  return {
    state: "unknown",
    reason: "Could not classify the current page state."
  };
}

export function extractTextFromHtml(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractButtonsFromHtml(html: string): ButtonSnapshot[] {
  const buttons: ButtonSnapshot[] = [];
  const buttonLike = /<(button|a)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  let match: RegExpExecArray | null;

  while ((match = buttonLike.exec(html))) {
    const attributes = match[2] ?? "";
    const body = extractTextFromHtml(match[3] ?? "");
    if (!body) {
      continue;
    }
    buttons.push({
      text: body,
      disabled: /\bdisabled\b/i.test(attributes) || /aria-disabled=["']?true/i.test(attributes)
    });
  }

  return buttons;
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function firstMissingKeyword(text: string, keywords: string[]): string | undefined {
  return keywords.find((keyword) => !text.includes(keyword));
}

function firstMatchingPattern(text: string, patterns: RegExp[]): string | undefined {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[0]) {
      return match[0];
    }
  }
  return undefined;
}

function firstMatchingButton(buttons: ButtonSnapshot[], patterns: RegExp[], allowDisabled: boolean): ButtonSnapshot | undefined {
  return buttons.find((button) => {
    if (button.disabled && !allowDisabled) {
      return false;
    }
    return patterns.some((pattern) => pattern.test(button.text));
  });
}
