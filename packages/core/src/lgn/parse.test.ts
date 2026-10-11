import { describe, expect, it } from "vitest";
import { ARROW_TOKENS, parseStatements, readLabel, writeLabel } from "./parse";

const one = (source: string) => {
  const { statements, errors } = parseStatements(source);
  expect(errors).toEqual([]);
  expect(statements).toHaveLength(1);
  return statements[0];
};
const errorOf = (source: string) => parseStatements(source).errors;

describe("parseStatements: nodes", () => {
  it("parses id, kind, label and status", () => {
    expect(one("redis [cache]: Redis {struck}")).toEqual({
      type: "node",
      line: 1,
      id: "redis",
      kind: "cache",
      label: "Redis",
      status: "struck",
    });
  });

  it("allows a bare id and an id with only a status (the patch form)", () => {
    expect(one("redis")).toEqual({ type: "node", line: 1, id: "redis" });
    expect(one("redis {chosen}")).toEqual({ type: "node", line: 1, id: "redis", status: "chosen" });
    expect(one("redis:Cache layer")).toMatchObject({ label: "Cache layer" });
  });

  it("keeps colons inside labels and honours quoted labels", () => {
    expect(one("pg [datastore]: Postgres: primary")).toMatchObject({ label: "Postgres: primary" });
    expect(one('x: "  padded {struck}  "')).toMatchObject({ label: "  padded {struck}  " });
    expect(one('x: "say \\"hi\\""')).toMatchObject({ label: 'say "hi"' });
  });

  it("tolerates extra whitespace, CRLF line endings and blank lines", () => {
    const { statements, errors } = parseStatements("\r\n  a   [service]  :   A  \r\n\r\n  b\r\n");
    expect(errors).toEqual([]);
    expect(statements.map((s) => s.line)).toEqual([2, 4]);
  });
});

describe("parseStatements: edges", () => {
  it("recognises every arrow token", () => {
    for (const t of ARROW_TOKENS) {
      expect(one(`a ${t.token} b`)).toMatchObject({
        type: "edge",
        from: "a",
        to: "b",
        arrow: t.arrow,
        style: t.style,
      });
    }
  });

  it("reads labels (with colons) and a trailing status", () => {
    expect(one("web -.-> pg: cache miss: query {struck}")).toEqual({
      type: "edge",
      line: 1,
      from: "web",
      to: "pg",
      arrow: "directed",
      style: "dashed",
      label: "cache miss: query",
      status: "struck",
    });
  });

  it("accepts arrows without surrounding spaces", () => {
    expect(one("a->b")).toMatchObject({ from: "a", to: "b" });
    expect(one("a<->b: both")).toMatchObject({ arrow: "bidirectional", label: "both" });
  });

  it("has an arrow token for every arrow and style combination", () => {
    const combos = new Set(ARROW_TOKENS.map((t) => `${t.arrow}/${t.style}`));
    expect(combos.size).toBe(9);
  });
});

describe("parseStatements: groups and fragments", () => {
  it("parses a group with members and an optional struck status", () => {
    expect(one("group app: Application boundary {web, redis}")).toEqual({
      type: "group",
      line: 1,
      id: "app",
      label: "Application boundary",
      members: ["web", "redis"],
    });
    expect(one("group old: Legacy {a} {struck}")).toMatchObject({ status: "struck" });
  });

  it("parses fragment keywords", () => {
    const { statements, errors } = parseStatements(
      "alt cache hit\nelse cache miss\nend\nloop retry\nend",
    );
    expect(errors).toEqual([]);
    expect(statements.map((s) => s.type)).toEqual([
      "fragment-open",
      "fragment-else",
      "fragment-end",
      "fragment-open",
      "fragment-end",
    ]);
    expect(statements[0]).toMatchObject({ kind: "alt", label: "cache hit" });
    expect(statements[1]).toMatchObject({ label: "cache miss" });
    expect(statements[3]).toMatchObject({ kind: "loop", label: "retry" });
  });

  it("does not mistake ids that merely start with a keyword for fragments", () => {
    expect(one("alternative [service]: Alt")).toMatchObject({ type: "node", id: "alternative" });
    expect(one("endpoint -> parser")).toMatchObject({
      type: "edge",
      from: "endpoint",
      to: "parser",
    });
  });
});

describe("parseStatements: comments", () => {
  it("skips whole-line comments but keeps # inside labels", () => {
    const { statements } = parseStatements(
      "# a comment\n  # indented comment\nc [service]: Issue #42 tracker",
    );
    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatchObject({ label: "Issue #42 tracker", line: 3 });
  });
});

describe("parseStatements: errors carry line numbers and actionable text", () => {
  it("rejects an unknown node kind and lists the valid ones", () => {
    const [e] = errorOf("a [service]: A\nb [database]: B");
    expect(e?.line).toBe(2);
    expect(e?.message).toContain('unknown node kind "database"');
    expect(e?.message).toContain("datastore");
  });

  it("rejects look-alike arrows", () => {
    for (const arrow of ["=>", "-->", "→", "==>"]) {
      const [e] = errorOf(`a ${arrow} b`);
      expect(e?.message, arrow).toContain(`unknown arrow "${arrow}"`);
      expect(e?.message).toContain("->");
    }
  });

  it("rejects ids with spaces or capitals and suggests the slug form", () => {
    const [e] = errorOf("Web Server [service]: x");
    expect(e?.message).toContain('"Web" is not a valid node id');
    expect(e?.message).toContain("web_server");
  });

  it("rejects reserved words as node ids", () => {
    expect(errorOf("group")[0]?.message).toContain("group");
    expect(errorOf("end: x")[0]?.message).toContain("reserved word");
    expect(errorOf("a -> group")[0]?.message).toContain("reserved word");
  });

  it("rejects malformed groups", () => {
    expect(errorOf("group app {web}")[0]?.message).toContain("invalid group");
    expect(errorOf("group app: App {}")[0]?.message).toContain("at least one member");
    expect(errorOf("group app: App {Web Server}")[0]?.message).toContain(
      '"Web Server" is not a valid node id',
    );
    expect(errorOf("group app: App {a} {chosen}")[0]?.message).toContain("only be {struck}");
  });

  it("reports every bad line, in order", () => {
    const errors = errorOf("ok [service]: Fine\nbad => x\nalso [nope]: bad\nfine -> ok");
    expect(errors.map((e) => e.line)).toEqual([2, 3]);
  });

  it("falls back to a generic message for gibberish", () => {
    expect(errorOf("a b c")[0]?.message).toContain("could not understand");
  });
});

describe("label helpers", () => {
  it("readLabel trims, unquotes and treats empty as missing", () => {
    expect(readLabel("  Redis ")).toBe("Redis");
    expect(readLabel('"  x  "')).toBe("  x  ");
    expect(readLabel("   ")).toBeUndefined();
    expect(readLabel(undefined)).toBeUndefined();
  });

  it("writeLabel quotes only when needed, and readLabel inverts it", () => {
    for (const label of [
      "Redis",
      "a: b",
      "  padded",
      "trailing ",
      '"quoted"',
      "ends {struck}",
      "x # y",
      'back\\slash "q"',
    ]) {
      expect(readLabel(writeLabel(label)), label).toBe(label);
    }
    expect(writeLabel("Redis")).toBe("Redis");
    expect(writeLabel("a: b")).toBe("a: b");
    expect(writeLabel("ends {struck}")).toBe('"ends {struck}"');
  });
});
