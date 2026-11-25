import { assertEquals, assertMatch, assertNotMatch } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { fallbackTitle, formatAuditTrail, formatTranscript, parseSummary, redact } from "./miraIssueReport.ts";

Deno.test("reports never carry keys, session tokens or card-like numbers", () => {
  const text = redact("Bearer abc.def.ghi sk-1234567890abcdef eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop 4111111111111111");
  assertNotMatch(text, /abc\.def|sk-1234|eyJhbGci|4111111111111111/);
});

Deno.test("the transcript shows who said what, in Budapest time", () => {
  const text = formatTranscript([
    { role: "user", content: "who is the supervisor?", created_at: "2026-11-19T13:10:00Z" },
    { role: "assistant", content: "Eszter Kovács", created_at: "2026-11-19T13:10:05Z", model: "gpt-4o-mini" },
  ]);
  assertMatch(text, /19\/11\/2026, 14:10:00\] Person:\nwho is the supervisor\?/);
  assertMatch(text, /Mira \(gpt-4o-mini\):\nEszter Kovács/);
});

Deno.test("the technical trail lists model, tools, tokens and time per turn", () => {
  const text = formatAuditTrail([{
    created_at: "2026-11-19T13:10:05Z", question: "who is the supervisor?", model: "gpt-4.1",
    scopes_used: ["tool-get_room_detail"], input_tokens: 9000, output_tokens: 120, duration_ms: 4200, workflow: "standard",
  }]);
  assertMatch(text, /model=gpt-4\.1 depth\/workflow=standard tools=get_room_detail tokens=9120 time=4\.2s/);
});

Deno.test("the summary and title are split, with a fallback title from the last question", () => {
  const parsed = parseSummary("What the person needed: x\nWhat went wrong: y\nTitle: Wrong supervisor for room 038");
  assertEquals(parsed.title, "Wrong supervisor for room 038");
  assertNotMatch(parsed.summary, /Title:/);
  assertEquals(
    fallbackTitle([{ role: "user", content: "who is the  supervisor?", created_at: "" }], ""),
    "Mira problem: who is the supervisor?",
  );
});
