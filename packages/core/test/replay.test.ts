import { describe, expect, it } from "vitest";
import { compileScript, replayAll, replayCase, type ReplayCase } from "../src";
import { SOURCES } from "../../../scripts/src";

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

describe("the Request: an LLM completion writes what the run that ordered it asked", () => {
  const read = (key: string) => compileScript(SOURCES[key]!);
  const prompt = "Write a short cold email to ada@example.com.";

  it("a writer asks first, then sends the text of the LLM completion it ordered", () => {
    const writer = read("message_written/wr_short/v2");
    const c: ReplayCase = {
      id: "writer",
      units: { email_found: { email: "ada@example.com" }, template_written: { text: "Hi {{first_name}}" }, brand_context: { summary: "Dashboards." }, llm_completion: { model: "claude", text: "Hi Ada, ..." }, rating: {} },
      calls: [],
      asks: [{ prompt: "Write a short cold email to ada@example.com, in plain text, from this template.\n\nTemplate:\nHi {{first_name}}\n\nWhat we sell:\nDashboards." }],
      expect: { content: { body: "Hi Ada, ...", template: "writer:template_written:0" } },
    };
    expect(replayCase(writer, c)).toEqual({ id: "writer", match: true, diffs: [] });
    expect(replayCase(writer, { ...c, asks: [{ prompt: "something else" }] }).diffs[0]).toContain("asks");
  });

  it("our API's script and the client's Claude write the Request's prompt; with no Request they write nothing", () => {
    const api = read("llm_completion/gemini_flash/v2");
    expect(replayCase(api, { id: "api", units: {}, request: { prompt }, calls: [{ name: "llm.complete", args: { model: "gemini-3.7-flash", prompt }, answer: { ok: true, data: { text: "Hi" } } }], expect: { content: { model: "gemini-3.7-flash", text: "Hi" } } }).match).toBe(true);
    expect(replayCase(api, { id: "none", units: {}, calls: [], expect: { nothing: true } }).match).toBe(true);
    const mine = read("llm_completion/clients_claude/v1");
    expect(replayCase(mine, { id: "mine", units: {}, request: { prompt }, calls: [{ name: "claude_local.complete", args: { prompt }, answer: { ok: true, data: { model: "claude", text: "Hi" } } }], expect: { content: { model: "claude", text: "Hi" } } }).match).toBe(true);
    // The client's app offline: only the client's Claude, so nothing is written and our API is never called.
    expect(replayCase(mine, { id: "mine-off", units: {}, request: { prompt }, calls: [{ name: "claude_local.complete", answer: { ok: false, data: { offline: true } } }], expect: { nothing: true } }).match).toBe(true);
  });

  it("the client's Claude first: after 10 minutes with no app online, our API writes it", () => {
    const first = read("llm_completion/clients_claude_first/v1");
    const answered = { name: "claude_local.complete", args: { prompt, offline_after_minutes: 10 }, answer: { ok: true, data: { model: "claude", text: "From my Claude" } } };
    expect(replayCase(first, { id: "on", units: {}, request: { prompt }, calls: [answered], expect: { content: { model: "claude", text: "From my Claude" } } }).match).toBe(true);
    const offline = { ...answered, answer: { ok: false, data: { offline: true } } };
    const api = { name: "llm.complete", args: { model: "gemini-3.7-flash", prompt }, answer: { ok: true, data: { text: "From our API" } } };
    expect(replayCase(first, { id: "off", units: {}, request: { prompt }, calls: [offline, api], expect: { content: { model: "gemini-3.7-flash", text: "From our API" } } })).toEqual({ id: "off", match: true, diffs: [] });
  });
});
