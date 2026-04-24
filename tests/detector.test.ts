import assert from "node:assert/strict";
import test from "node:test";
import {
  detectAvailabilityFromText,
  extractButtonsFromHtml,
  extractTextFromHtml
} from "../src/detector.js";

test("detects enabled purchase button as available", () => {
  const result = detectAvailabilityFromText("目标日期 目标票档", [
    { text: "立即购买", disabled: false }
  ]);

  assert.equal(result.state, "available");
});

test("detects sold-out state", () => {
  const result = detectAvailabilityFromText("目标票档 已售罄", [
    { text: "已售罄", disabled: true }
  ]);

  assert.equal(result.state, "sold_out");
});

test("pauses on login or captcha prompts", () => {
  assert.equal(detectAvailabilityFromText("请先登录后继续").state, "blocked");
  assert.equal(detectAvailabilityFromText("安全验证 请完成验证码").state, "blocked");
});

test("pauses on mainland China region restrictions", () => {
  assert.equal(detectAvailabilityFromText("当前地区不可用，仅限中国大陆 IP 访问").state, "blocked");
});

test("does not treat order submission or payment actions as availability", () => {
  const result = detectAvailabilityFromText("确认订单", [
    { text: "提交订单", disabled: false }
  ]);

  assert.equal(result.state, "blocked");

  const paymentResult = detectAvailabilityFromText("订单信息", [
    { text: "下一步支付 ￥488", disabled: false }
  ]);

  assert.equal(paymentResult.state, "blocked");
});

test("requires configured keywords to be visible", () => {
  const result = detectAvailabilityFromText("只有日期", [
    { text: "立即购买", disabled: false }
  ], { keywords: ["只有日期", "目标票档"] });

  assert.equal(result.state, "unknown");
  assert.equal(result.reason, "Target keyword lines not all visible: 目标票档");
});

test("requires every configured keyword line before alerting", () => {
  const result = detectAvailabilityFromText("2026-05-08 周五 ￥488 立即购票", [
    { text: "立即购票", disabled: false }
  ], { keywords: ["2026-05-08", "￥488", "内场"] });

  assert.equal(result.state, "unknown");
  assert.equal(result.matchedText, "内场");
});

test("ignores blank keyword lines while requiring all non-empty lines", () => {
  const result = detectAvailabilityFromText("2026-05-08 周五 ￥488 内场 立即购票", [
    { text: "立即购票", disabled: false }
  ], { keywords: ["2026-05-08", "", "  ", "￥488", "内场"] });

  assert.equal(result.state, "available");
});

test("matches target keywords while ignoring whitespace differences", () => {
  const result = detectAvailabilityFromText("2026.4.24 ￥ 138 老外 难游轮票", [
    { text: "立即购票", disabled: false }
  ], { keywords: ["2026.4.24", "￥138", "老外难游轮票"] });

  assert.equal(result.state, "available");
});

test("matches date keywords with or without zero padding", () => {
  const result = detectAvailabilityFromText("2026-05-08 周五 ￥ 488 内场 A1区", [
    { text: "立即购票", disabled: false }
  ], { keywords: ["2026-5-8 周五", "￥488", "内场"] });

  assert.equal(result.state, "available");
});

test("does not use another ticket option's purchase button for the target", () => {
  const result = detectAvailabilityFromText(
    "2026-05-08 周五 价格：¥298(二等座看台南3区) ¥488(内场A3区)已售罄 ¥488(内场B1区)已售罄 数量：1 立即购票",
    [{ text: "立即购票", disabled: false }],
    { keywords: ["2026-05-08", "￥488", "内场"] }
  );

  assert.equal(result.state, "sold_out");
  assert.equal(result.reason, "Target ticket option is sold out.");
});

test("matches yuan symbols across fullwidth and halfwidth forms", () => {
  const result = detectAvailabilityFromText("2026.4.24 ¥ 138 老外 难游轮票", [
    { text: "立即购票", disabled: false }
  ], { keywords: ["2026.4.24", "￥138", "老外难游轮票"] });

  assert.equal(result.state, "available");
});

test("detects purchase entry text when no target is configured", () => {
  const result = detectAvailabilityFromText("2026.4.24 ￥ 138 老外 难游轮票 立即购票", []);

  assert.equal(result.state, "available");
  assert.equal(result.matchedText, "立即购票");
});

test("does not use a page-level purchase button as target availability", () => {
  const result = detectAvailabilityFromText(
    "2026-05-08 周五 ¥488(内场A3区)已售罄 ¥298(看台南3区) 立即购票",
    [{ text: "立即购票", disabled: false }],
    { keywords: ["2026-05-08", "￥488"] }
  );

  assert.equal(result.state, "sold_out");
  assert.equal(result.reason, "Target ticket option is sold out.");
});

test("does not use page-level availability text as target availability", () => {
  const result = detectAvailabilityFromText(
    "2026-05-08 周五 ¥488(内场A3区)已售罄 ¥298(看台南3区) 有票",
    [],
    { keywords: ["2026-05-08", "￥488"] }
  );

  assert.equal(result.state, "sold_out");
});

test("does not alert when target date button is disabled", () => {
  const result = detectAvailabilityFromText(
    "2026-05-08 周五 ¥488(内场A3区) 立即购票",
    [
      { text: "2026-05-08 周五", disabled: true },
      { text: "¥488(内场A3区)", disabled: false },
      { text: "立即购票", disabled: false }
    ],
    { keywords: ["2026-05-08", "￥488", "内场"] }
  );

  assert.equal(result.state, "sold_out");
  assert.equal(result.reason, "Target date/session option is disabled or unavailable.");
});

test("does not alert when target ticket option button is disabled", () => {
  const result = detectAvailabilityFromText(
    "2026-05-08 周五 ¥488(内场A3区)已售罄 ¥298(看台南3区) 立即购票",
    [
      { text: "2026-05-08 周五", disabled: false },
      { text: "¥488(内场A3区)已售罄", disabled: true },
      { text: "立即购票", disabled: false }
    ],
    { keywords: ["2026-05-08", "￥488", "内场"] }
  );

  assert.equal(result.state, "sold_out");
  assert.equal(result.reason, "Target ticket option button is disabled or sold out.");
});

test("detects target option buttons as available when date and ticket are enabled", () => {
  const result = detectAvailabilityFromText(
    "2026-05-08 周五 ¥488(内场A3区) 立即购票",
    [
      { text: "2026-05-08 周五", disabled: false },
      { text: "¥488(内场A3区)", disabled: false },
      { text: "立即购票", disabled: false }
    ],
    { keywords: ["2026-05-08", "￥488", "内场"] }
  );

  assert.equal(result.state, "available");
  assert.equal(result.reason, "Target date/session and ticket option buttons appear available.");
});

test("supports separate date and seat option buttons", () => {
  const result = detectAvailabilityFromText(
    "2026-05-08 周五 ¥488(内场A1区) 立即购票",
    [
      { text: "2026-05-08 周五", disabled: false },
      { text: "¥488(内场A1区)", disabled: false },
      { text: "立即购票", disabled: false }
    ],
    { keywords: ["2026-05-08", "内场"] }
  );

  assert.equal(result.state, "available");
  assert.equal(result.reason, "Target date/session and ticket option buttons appear available.");
});

test("uses selected ticket option to disambiguate repeated price keyword", () => {
  const result = detectAvailabilityFromText(
    "2026.4.24 ¥148(solo电竞酒店住宿票) ¥148(ReMax热麦电竞酒店住宿票) 立即购买",
    [
      { text: "2026.4.24", disabled: false, selected: true },
      { text: "¥148(solo电竞酒店住宿票)", disabled: false, selected: true },
      { text: "¥148(ReMax热麦电竞酒店住宿票)", disabled: false },
      { text: "立即购买", disabled: false }
    ],
    { keywords: ["2026.4.24", "¥148"] }
  );

  assert.equal(result.state, "available");
  assert.equal(result.matchedText, "¥148(solo电竞酒店住宿票)");
});

test("defaults to first repeated keyword option when no option is selected", () => {
  const result = detectAvailabilityFromText(
    "2026.4.24 ¥148(solo电竞酒店住宿票) ¥148(ReMax热麦电竞酒店住宿票) 立即购买",
    [
      { text: "2026.4.24", disabled: false, selected: true },
      { text: "¥148(solo电竞酒店住宿票)", disabled: false },
      { text: "¥148(ReMax热麦电竞酒店住宿票)", disabled: false },
      { text: "立即购买", disabled: false }
    ],
    { keywords: ["2026.4.24", "¥148"] }
  );

  assert.equal(result.state, "available");
  assert.equal(result.matchedText, "¥148(solo电竞酒店住宿票)");
});

test("requires every non-date keyword line to match the same ticket option button", () => {
  const result = detectAvailabilityFromText(
    "2026-05-08 周五 ¥488(看台A1区) ¥298(内场A1区) 立即购票",
    [
      { text: "2026-05-08 周五", disabled: false },
      { text: "¥488(看台A1区)", disabled: false },
      { text: "¥298(内场A1区)", disabled: false },
      { text: "立即购票", disabled: false }
    ],
    { keywords: ["2026-05-08", "￥488", "内场"] }
  );

  assert.equal(result.state, "unknown");
  assert.equal(result.reason, "Target keywords are visible, but target ticket option availability could not be confirmed.");
});

test("order handoff button takes priority over missing target keywords", () => {
  const result = detectAvailabilityFromText("确认订单", [
    { text: "下一步支付 ￥488", disabled: false }
  ], { keywords: ["不存在的票档"] });

  assert.equal(result.state, "blocked");
  assert.equal(result.matchedText, "下一步支付 ￥488");
});

test("detects order information page from visible text", () => {
  const result = detectAvailabilityFromText("订单信息 联系人 应付金额 ￥138", [], {
    keywords: ["不存在的票档"]
  });

  assert.equal(result.state, "blocked");
  assert.equal(result.matchedText, "订单信息");
});

test("extracts fixture text and button snapshots", () => {
  const html = "<button disabled>\u5df2\u552e\u7f44</button><a>\u7acb\u5373\u8d2d\u4e70</a>";
  assert.equal(extractTextFromHtml(html), "\u5df2\u552e\u7f44 \u7acb\u5373\u8d2d\u4e70");
  assert.deepEqual(extractButtonsFromHtml(html), [
    { text: "\u5df2\u552e\u7f44", disabled: true },
    { text: "\u7acb\u5373\u8d2d\u4e70", disabled: false }
  ]);
});

test("detects availability when keyword is only in button text, not in page text", () => {
  const result = detectAvailabilityFromText("\u6d3b\u52a8\u8be6\u60c5 \u7acb\u5373\u8d2d\u7968", [
    { text: "2026.4.25", disabled: false, selected: true },
    { text: "\u00a588(\u5357\u4eac\u8230\u5343\u4eba\u5bb4)", disabled: false, selected: true },
    { text: "\u7acb\u5373\u8d2d\u7968", disabled: false }
  ], { keywords: ["2026.4.25", "\u00a588", "\u5357\u4eac"] });

  assert.equal(result.state, "available");
});

test("disambiguates multiple same-price buttons by additional keyword", () => {
  const result = detectAvailabilityFromText(
    "2026.4.25 \u00a588(\u5357\u4eac\u8230\u5343\u4eba\u5bb4) \u00a588(coser\u7279\u6548\u7968) \u7acb\u5373\u8d2d\u7968",
    [
      { text: "2026.4.25", disabled: false, selected: true },
      { text: "\u00a588(\u5357\u4eac\u8230\u5343\u4eba\u5bb4)", disabled: false },
      { text: "\u00a588(coser\u7279\u6548\u7968)", disabled: false },
      { text: "\u7acb\u5373\u8d2d\u7968", disabled: false }
    ],
    { keywords: ["2026.4.25", "\u00a588", "\u5357\u4eac"] }
  );

  assert.equal(result.state, "available");
  assert.equal(result.matchedText, "\u00a588(\u5357\u4eac\u8230\u5343\u4eba\u5bb4)");
});

test("button classification runs before keyword text check", () => {
  const result = detectAvailabilityFromText("", [
    { text: "2026-05-08 \u5468\u4e94", disabled: false, selected: true },
    { text: "\u00a5488(\u5185\u573aA1\u533a)", disabled: false },
    { text: "\u7acb\u5373\u8d2d\u7968", disabled: false }
  ], { keywords: ["2026-05-08", "\uffe5488", "\u5185\u573a"] });

  assert.equal(result.state, "available");
  assert.equal(result.reason, "Target date/session and ticket option buttons appear available.");
});
