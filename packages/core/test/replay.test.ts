import { describe, expect, it } from "vitest";
import { compileScript, replayAll, replayCase, type ReplayCase } from "../src";

const source = `
import type { ScriptContext, ScriptResult } from "@gtm-factory/core";
export default function run(ctx: ScriptContext): ScriptResult {
  const lead = ctx.get("lead_identified");
  const r = ctx.vendor.call("verifier.check", { email: String(lead.content.email).toLowerCase() });
  if (!r.ok) throw new Error("verifier failed: " + String(r.data.error));
  return { content: { email: String(lead.content.email).toLowerCase(), verdict: r.data.verdict } };
}`;

const base: ReplayCase = {
  id: "a",
  units: { lead_identified: { email: "Ada@Example.com" } },
  calls: [{ name: "verifier.check", args: { email: "ada@example.com" }, answer: { ok: true, data: { verdict: "valid" } } }],
  expect: { content: { email: "ada@example.com", verdict: "valid" } },
};

describe("replay: a script proven against recorded cases", () => {
  const code = compileScript(source);

  it("matches when the calls, the requests and the result are the record's", () => {
    expect(replayCase(code, base)).toEqual({ id: "a", match: true, diffs: [] });
  });

  it("names what differs: a request, a result, a call the record never made, a failure", () => {
    const req = replayCase(code, { ...base, calls: [{ ...base.calls[0]!, args: { email: "ADA@example.com" } }] });
    expect(req.match).toBe(false);
    expect(req.diffs[0]).toContain("request.email");
    const res = replayCase(code, { ...base, expect: { content: { email: "ada@example.com", verdict: "invalid" } } });
    expect(res.diffs[0]).toContain("content.verdict");
    expect(replayCase(code, { ...base, calls: [] }).diffs[0]).toContain("the record made no more calls");
    const fail = { ...base, calls: [{ name: "verifier.check", answer: { ok: false, data: { error: "429" } } }], expect: { fails: "verifier failed: 429" } };
    expect(replayCase(code, fail).match).toBe(true);
    expect(replayAll(code, [base, fail, { ...base, id: "b", units: {} }])).toMatchObject({ cases: 3, matches: 2 });
  });
});
