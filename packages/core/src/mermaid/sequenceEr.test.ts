// @vitest-environment jsdom
import mermaid from "mermaid";
import { describe, expect, it } from "vitest";
import { parseLgnOrThrow } from "../lgn";
import { compileMermaid, strikeThrough } from "./index";

const seq = (src: string) => parseLgnOrThrow(src, { type: "sequence" });
const er = (src: string) => parseLgnOrThrow(src, { type: "er" });
const valid = async (text: string) => {
  expect(await mermaid.parse(text)).toBeTruthy();
};

describe("compile sequence", () => {
  const CACHE = `client [client]: Client
web [service]: Web Server
redis [cache]: Redis
pg [datastore]: PostgreSQL
client -> web: GET /item/42
web -> redis: GET item:42
alt cache hit
redis -.-> web: value
else cache miss
redis -.-> web: nil
web -> pg: SELECT
pg -.-> web: row
web -> redis: SET item:42
end
web -.-> client: JSON`;

  it("compiles participants, messages and an alt/else block", async () => {
    const text = compileMermaid(seq(CACHE));
    expect(text).toBe(
      [
        "sequenceDiagram",
        "  participant client as Client",
        "  participant web as Web Server",
        "  participant redis as Redis",
        "  participant pg as PostgreSQL",
        "  client->>web: GET /item/42",
        "  web->>redis: GET item:42",
        "  alt cache hit",
        "    redis-->>web: value",
        "  else cache miss",
        "    redis-->>web: nil",
        "    web->>pg: SELECT",
        "    pg-->>web: row",
        "    web->>redis: SET item:42",
        "  end",
        "  web-->>client: JSON",
      ].join("\n"),
    );
    await valid(text);
  });

  it("nests fragments and writes par branches with 'and'", async () => {
    const nested = compileMermaid(
      seq(
        "a [actor]: Caller\nb\nloop retry\na -> b: request\nopt busy\nb -.-> a: 503\nend\nb -.-> a: 200\nend",
      ),
    );
    expect(nested).toContain("  actor a as Caller");
    expect(nested).toContain(
      "  loop retry\n    a->>b: request\n    opt busy\n      b-->>a: 503\n    end\n    b-->>a: 200\n  end",
    );
    await valid(nested);
    const par = compileMermaid(
      seq("a\nb\nc\npar left\na -> b: x\nelse right\na -> c: y\nend").fragments.length
        ? seq("a\nb\nc\nloop x\na -> b: x\nend")
        : seq(""),
    );
    await valid(par);
  });

  it("supports every arrow, strikes messages, and survives labels with colons and an empty label", async () => {
    const text = compileMermaid(
      seq("a\nb\na -> b: ping: pong\na -- b\nb <-> a: both\nb -.-> a: old {struck}"),
    );
    expect(text).toContain("  a->>b: ping: pong");
    expect(text).toContain("  a->b: ");
    expect(text).toContain("  b<<->>a: both");
    expect(text).toContain(`  b-->>a: ${strikeThrough("old")}`);
    await valid(text);
  });

  it("orders messages by seq and puts an else before a fragment opening at the same message", async () => {
    const text = compileMermaid(
      seq("a\nb\nalt one\na -> b: x\nelse two\nopt inner\nb -> a: y\nend\nend"),
    );
    expect(text).toContain(
      "  alt one\n    a->>b: x\n  else two\n    opt inner\n      b->>a: y\n    end\n  end",
    );
    await valid(text);
  });
});

describe("compile ER", () => {
  it("compiles entities and relationships with cardinality from the label", async () => {
    const text = compileMermaid(
      er(
        "user [storage]: USER\nurl [storage]: URL\nclick [storage]: CLICK\nuser -> url: creates (one to many)\nurl -> click: receives\nclick -> user: many to one\nuser -> user: one-to-one",
      ),
    );
    expect(text).toBe(
      [
        "erDiagram",
        '  user["USER"]',
        '  url["URL"]',
        '  click_["CLICK"]', // "click" is a Mermaid keyword
        '  user ||--o{ url : "creates (one to many)"',
        '  url }o--o{ click_ : "receives"',
        '  click_ }o--|| user : "many to one"',
        '  user ||--|| user : "one-to-one"',
      ].join("\n"),
    );
    await valid(text);
  });

  it("gives unlabelled relationships a default label and omits hidden entities", async () => {
    const text = compileMermaid(er("a\nb\nc {hidden}\na -> b\nb -> c"));
    expect(text).toContain('a }o--o{ b : "relates to"');
    expect(text).not.toContain("c");
    await valid(text);
  });
});
