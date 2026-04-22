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
  ], { keywords: ["目标日期", "目标票档"] });

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
});

test("matches target keywords while ignoring whitespace differences", () => {
  const result = detectAvailabilityFromText("2026.4.24 ￥ 138 老外 难游轮票", [
    { text: "立即购票", disabled: false }
  ], { keywords: ["2026.4.24", "￥138"] });

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
  ], { keywords: ["2026.4.24", "￥138"] });

  assert.equal(result.state, "available");
});

test("detects purchase entry text when it is not exposed as a button snapshot", () => {
  const result = detectAvailabilityFromText("2026.4.24 ￥ 138 老外 难游轮票 立即购票", [], {
    keywords: ["2026.4.24", "￥138"]
  });

  assert.equal(result.state, "available");
  assert.equal(result.matchedText, "立即购票");
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
  const html = "<button disabled>已售罄</button><a>立即购买</a>";
  assert.equal(extractTextFromHtml(html), "已售罄 立即购买");
  assert.deepEqual(extractButtonsFromHtml(html), [
    { text: "已售罄", disabled: true },
    { text: "立即购买", disabled: false }
  ]);
});
