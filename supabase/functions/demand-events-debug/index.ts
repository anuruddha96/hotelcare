// TEMPORARY diagnostic for the AI event search. Deleted after use.
Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (url.searchParams.get("t") !== "ev-dbg-4a91c7") return new Response("no", { status: 404 });
  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) return new Response("no key", { status: 500 });
  const month = url.searchParams.get("month") ?? "2026-08";
  const model = url.searchParams.get("model") ?? "gpt-4.1";
  const useSearch = url.searchParams.get("search") !== "0";

  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      events: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            date: { type: "string" },
            end_date: { type: ["string", "null"] },
            title: { type: "string" },
            category: { type: "string", enum: ["concert", "festival", "sports", "conference", "fair", "holiday", "other"] },
            venue: { type: ["string", "null"] },
            expected_impact: { type: "string", enum: ["low", "medium", "high"] },
            recurs_annually: { type: "boolean" },
            source_url: { type: "string" },
            confidence: { type: "number" },
          },
          required: ["date", "end_date", "title", "category", "venue", "expected_impact", "recurs_annually", "source_url", "confidence"],
        },
      },
    },
    required: ["events"],
  };

  const body: Record<string, unknown> = {
    model,
    instructions: [
      "You are a hotel-market analyst building an events calendar that drives room pricing.",
      "You MUST use the web search tool for every request and read the official event page, the venue's programme page, the city tourism board, or a reputable local listing before reporting an event.",
      "Report the exact published dates. Never estimate, never round a festival to a full week, and never rely on memory.",
      "Include the full range of demand drivers: arena and club concerts, festivals, sport fixtures and races, congresses, trade fairs and exhibitions, public holidays, school holidays, and smaller published local events that still fill hotels.",
      "Every event must include the source URL you read the dates from. If you cannot find a source, leave the event out.",
      "Only include events that take place, at least partly, inside the requested month and city.",
    ].join(" "),
    input: `List demand-driving events in Budapest, Hungary that occur between ${month}-01 and ${month}-28. For each event give: date (YYYY-MM-DD first day), end_date (YYYY-MM-DD, only for multi-day events), title, category (concert, festival, sports, conference, fair, holiday, other), venue, expected_impact on hotel demand (low, medium, high), whether it takes place on the same dates every year, the source_url you verified the dates on, and a confidence between 0 and 1. Be thorough: include small and mid-size published events too.`,
    text: { format: { type: "json_schema", name: "events", strict: true, schema } },
  };
  if (useSearch) { body.tools = [{ type: "web_search_preview", search_context_size: "high" }]; body.tool_choice = "auto"; }
  if (url.searchParams.get("temp") === "1") body.temperature = 0;

  const r = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let parsed: unknown = null;
  try {
    const j = JSON.parse(text);
    parsed = {
      status: j.status,
      incomplete: j.incomplete_details,
      error: j.error,
      outputTypes: (j.output ?? []).map((o: any) => o.type),
      outputText: (j.output_text ?? "").slice(0, 1200),
      message: JSON.stringify((j.output ?? []).filter((o: any) => o.type === "message")).slice(0, 2000),
    };
  } catch { /* raw below */ }
  return new Response(JSON.stringify({ httpStatus: r.status, parsed, raw: parsed ? undefined : text.slice(0, 1500) }, null, 2), {
    headers: { "Content-Type": "application/json" },
  });
});
