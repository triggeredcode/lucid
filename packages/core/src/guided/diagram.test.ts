import { describe, expect, it } from "vitest";
import { checkGraph } from "../model/graph";
import {
  adoptGraph,
  displayGraph,
  draftFromGraph,
  edgeNumber,
  graphChange,
  legend,
  newDraft,
  numberingHint,
  step,
  type DiagramDraft,
  type StepResult,
} from "./diagram";

/** Runs a script of utterances, applying each; returns the final draft and every echo. */
function run(
  lines: string[],
  start: DiagramDraft = newDraft(),
): { draft: DiagramDraft; echo: string[][]; results: StepResult[] } {
  let draft = start;
  const echo: string[][] = [];
  const results: StepResult[] = [];
  for (const line of lines) {
    const r = step(draft, line);
    results.push(r);
    if (r.kind === "applied") {
      draft = r.draft;
      echo.push(r.echo);
    } else if (r.kind === "nothing") echo.push(r.echo);
    else echo.push([r.kind]);
  }
  return { draft, echo, results };
}

const names = (d: DiagramDraft) => d.graph.nodes.map((n) => n.label);
const edges = (d: DiagramDraft) =>
  legend(d).edges.map((e) => `${String(e.no)}:${e.from}>${e.to}${e.label ? `[${e.label}]` : ""}`);

describe("components", () => {
  it("reads a list of keywords, as in 'add keywords: client, server, DNS, database'", () => {
    const { draft, echo } = run(["add keywords: client, server, DNS, database"]);
    expect(names(draft)).toEqual(["Client", "Server", "DNS", "Database"]);
    expect(draft.graph.nodes.map((n) => n.kind)).toEqual([
      "client",
      "service",
      "external",
      "datastore",
    ]);
    expect(echo[0]).toEqual(["Added 4 components: Client, Server, DNS, Database"]);
    expect(Object.values(draft.nodeNo)).toEqual([1, 2, 3, 4]);
  });

  it("gives each part the kind its name gives away, so the drawing shows a database, a queue, a CDN, a gateway", () => {
    const { draft } = run([
      "add keywords: browser, CDN, load balancer, API gateway, order service, Redis, PostgreSQL, Kafka, S3",
    ]);
    const kinds = Object.fromEntries(draft.graph.nodes.map((n) => [n.label, n.kind]));
    expect(kinds).toEqual({
      Browser: "client",
      CDN: "cdn",
      "Load Balancer": "loadbalancer",
      "API gateway": "gateway",
      "Order Service": "service",
      Redis: "cache",
      PostgreSQL: "datastore",
      Kafka: "queue",
      S3: "storage",
    });
  });

  it("reads one at a time, 'and' lists, and Wispr's own formatting", () => {
    const { draft } = run([
      "client",
      "server and the database",
      "Redis, then Kafka.",
      "the load balancer",
    ]);
    expect(names(draft)).toEqual([
      "Client",
      "Server",
      "Database",
      "Redis",
      "Kafka",
      "Load Balancer",
    ]);
    expect(draft.graph.nodes.at(-1)?.kind).toBe("loadbalancer");
  });

  it("fixes the spelling of well-known names and keeps what the person capitalised", () => {
    const { draft } = run(["postgres, RabbitMQ, web server"]);
    expect(names(draft)).toEqual(["PostgreSQL", "RabbitMQ", "Web Server"]);
  });

  it("does not add the same component twice, even under another name", () => {
    const { draft, echo } = run(["client, server", "Client, postgres", "postgresql"]);
    expect(names(draft)).toEqual(["Client", "Server", "PostgreSQL"]);
    expect(echo[2]).toEqual(["Already there: PostgreSQL"]);
  });

  it("numbers components in the order said and never reuses a number", () => {
    const { draft } = run(["a1, b1, c1", "delete 2", "d1"]);
    expect(draft.graph.nodes.map((n) => `${n.id}=${String(draft.nodeNo[n.id])}`)).toEqual([
      "a1=1",
      "c1=3",
      "d1=4",
    ]);
  });

  it("hands a long rambling sentence to the model", () => {
    const r = step(
      newDraft(),
      "I think the thing that talks to the other thing is basically the main controller of everything here",
    );
    expect(r.kind).toBe("unknown");
  });
});

describe("connections", () => {
  const base = () => run(["client, server, DNS, database"]).draft;

  it("numbers connections in the order said when there is no label", () => {
    const { draft, echo } = run(
      ["connections", "client to server", "server to DNS", "server to database"],
      base(),
    );
    expect(edges(draft)).toEqual(["1:Client>Server", "2:Server>DNS", "3:Server>Database"]);
    expect(echo[1]).toEqual(["Connection 1: Client → Server"]);
  });

  it("names the connection when it is said: 'from server to client returns HTML'", () => {
    const { draft } = run(["connections", "from server to client returns HTML"], base());
    expect(edges(draft)).toEqual(["1:Server>Client[returns HTML]"]);
  });

  it("reads verbs before the connector as the label", () => {
    const { draft } = run(
      [
        "connections",
        "client sends request to server",
        "server queries database",
        "client resolves domain with DNS",
      ],
      base(),
    );
    expect(edges(draft)[0]).toBe("1:Client>Server[sends request]");
    expect(edges(draft)[1]).toBe("2:Server>Database[queries]");
  });

  it("reads chains, fan-out and several connections in one breath", () => {
    const { draft } = run(
      ["connections", "client to server to database", "server to DNS and database, client to DNS"],
      base(),
    );
    expect(edges(draft)).toEqual([
      "1:Client>Server",
      "2:Server>Database",
      "3:Server>DNS",
      "4:Client>DNS",
    ]);
  });

  it("uses numbers for names: '1 to 2', 'node 2 to node 4'", () => {
    const { draft } = run(
      ["connections", "1 to 2", "node 2 to node 4", "number three to one"],
      base(),
    );
    expect(edges(draft)).toEqual(["1:Client>Server", "2:Server>Database", "3:DNS>Client"]);
  });

  it("makes a component that was forgotten, and says so", () => {
    const { draft, echo } = run(["connections", "server to cache"], base());
    expect(names(draft)).toContain("Cache");
    expect(draft.graph.nodes.at(-1)?.kind).toBe("cache");
    expect(echo[1]).toEqual(["New component: Cache", "Connection 1: Server → Cache"]);
    expect(draft.fresh).toHaveLength(1);
  });

  it("understands dashed, optional and two-way", () => {
    const { draft } = run(
      [
        "connections",
        "server to database dashed",
        "client and server talk to each other",
        "server to DNS if it misses",
      ],
      base(),
    );
    const e = draft.graph.edges;
    expect(e[0]).toMatchObject({ style: "dashed" });
    expect(e[1]).toMatchObject({ arrow: "bidirectional" });
    expect(e[2]).toMatchObject({ style: "dashed" });
  });

  it("does not connect the same pair twice, but a later label names the first connection", () => {
    const { draft, echo } = run(
      ["connections", "client to server", "client to server", "client to server returns the page"],
      base(),
    );
    expect(edges(draft)).toEqual(["1:Client>Server[returns the page]"]);
    expect(echo[2]).toEqual(["Already connected: Client → Server"]);
    expect(echo[3]?.[0]).toMatch(/^Updated connection 1/);
  });

  it("finds a component by one word of its name, and asks when two have it", () => {
    const start = run(["web server, app server, database"]).draft;
    const unique = run(["connections", "web to database"], start);
    expect(edges(unique.draft)).toEqual(["1:Web Server>Database"]);
    const r = step({ ...start, phase: "connections" }, "server to database");
    expect(r.kind).toBe("ask");
    if (r.kind === "ask") {
      expect(r.options.map((o) => o.label)).toEqual(["Web Server", "App Server"]);
      expect(edges(r.options[1]?.draft ?? start)).toEqual(["1:App Server>Database"]);
    }
  });

  it("never connects a component to itself", () => {
    const { draft, echo } = run(["connections", "server to server"], base());
    expect(draft.graph.edges).toHaveLength(0);
    expect(echo[1]?.[0]).toMatch(/^Skipped/);
  });

  it("hands what it cannot read to the model", () => {
    expect(
      step(
        { ...base(), phase: "connections" },
        "the cache should sit behind the server but only for reads",
      ).kind,
    ).toBe("unknown");
  });
});

describe("edit and commands that work anywhere", () => {
  const drawn = () =>
    run([
      "client, server, DNS, database",
      "connections",
      "client to server",
      "server to DNS",
      "server to database",
    ]).draft;

  it("renames, reverses, labels, restyles and reassigns by number", () => {
    const { draft } = run(
      [
        "rename 2 to API gateway",
        "reverse 2",
        "connection 1 is HTTP request",
        "make connection 3 dashed",
        "connection 2 goes from DNS to client",
      ],
      drawn(),
    );
    expect(names(draft)).toContain("API gateway");
    expect(edges(draft)).toEqual([
      "1:Client>API gateway[HTTP request]",
      "2:DNS>Client",
      "3:API gateway>Database",
    ]);
    expect(draft.graph.edges[2]?.style).toBe("dashed");
  });

  it("deletes components (with their connections) and connections", () => {
    const { draft } = run(["delete node 3", "delete connection 1"], drawn());
    expect(names(draft)).toEqual(["Client", "Server", "Database"]);
    expect(edges(draft)).toEqual(["3:Server>Database"]);
  });

  it("asks when a bare number could be a component or a connection", () => {
    const r = step(drawn(), "delete 3");
    expect(r.kind).toBe("ask");
    if (r.kind === "ask") {
      expect(r.question).toBe("Delete component 3 or connection 3?");
      expect(names(r.options[0]?.draft ?? drawn())).toEqual(["Client", "Server", "Database"]);
      expect(r.options[1]?.draft.graph.edges).toHaveLength(2);
    }
  });

  it("changes a component's kind, groups, sets direction and title", () => {
    const { draft } = run(
      ["4 is a cache", "group 2 and 4 as Backend", "direction left to right", "title Request flow"],
      drawn(),
    );
    expect(draft.graph.nodes[3]?.kind).toBe("cache");
    expect(draft.graph.groups[0]).toMatchObject({
      label: "Backend",
      members: ["server", "database"],
    });
    expect(draft.graph).toMatchObject({ direction: "LR", title: "Request flow" });
    expect(run(["ungroup Backend"], draft).draft.graph.groups).toHaveLength(0);
  });

  it("switches phase by word, at any time", () => {
    const r = run(["connections", "components", "edit", "think"]).draft;
    expect(r.phase).toBe("think");
    expect(run(["go to connections"]).draft.phase).toBe("connections");
    expect(run(["fine tune"]).draft.phase).toBe("edit");
  });

  it("answers undo, done and cancel for the caller", () => {
    expect(step(drawn(), "scratch that").kind).toBe("undo");
    expect(step(drawn(), "Undo.").kind).toBe("undo");
    expect(step(drawn(), "done").kind).toBe("done");
    expect(step(drawn(), "insert it").kind).toBe("done");
    expect(step(drawn(), "cancel").kind).toBe("cancel");
  });

  it("says when a number is nowhere, instead of failing", () => {
    expect(step(drawn(), "reverse 9")).toEqual({
      kind: "nothing",
      echo: ["There is no connection 9."],
    });
    expect(step(drawn(), "rename purple to green").kind).toBe("nothing");
  });
});

describe("think", () => {
  it("keeps what is said as notes to self and offers to draw it", () => {
    const { draft, results } = run([
      "think",
      "client talks to server",
      "hmm actually the cache sits after the server",
      "draw it",
    ]);
    expect(draft.scratch).toEqual([
      "client talks to server",
      "hmm actually the cache sits after the server",
    ]);
    expect(draft.graph.nodes).toHaveLength(0);
    expect(results.at(-1)).toEqual({
      kind: "draw",
      text: "client talks to server\nhmm actually the cache sits after the server",
    });
  });
});

describe("what the screen shows", () => {
  it("draws the numbers into the diagram and lists the loose components", () => {
    const d = run(["client, server, DNS", "connections", "client to server returns HTML"]).draft;
    const shown = displayGraph(d);
    expect(shown.nodes.map((n) => n.label)).toEqual(["1 · Client", "2 · Server", "3 · DNS"]);
    expect(shown.edges[0]?.label).toBe("#1 returns HTML");
    expect(legend(d).loose).toEqual(["DNS"]);
    expect(d.graph.nodes.map((n) => n.label)).toEqual(["Client", "Server", "DNS"]);
  });

  it("numbers an existing diagram's components in the order they appear", () => {
    const d = draftFromGraph(run(["a1, b1", "connections", "a1 to b1"]).draft.graph);
    expect(d.phase).toBe("edit");
    expect(Object.values(d.nodeNo)).toEqual([1, 2]);
    expect(edgeNumber(d.graph.edges[0] ?? ({ id: "e0" } as never))).toBe(1);
  });
});

describe("working with the model", () => {
  const built = () =>
    run(["client, server, database", "connections", "client to server", "server to database"])
      .draft;

  it("tells the model which number means what", () => {
    const hint = numberingHint(built());
    expect(hint).toContain("1 = client (Client)");
    expect(hint).toContain("3 = database (Database)");
    expect(hint).toContain("connection 2 = e2 (Server to Database)");
  });

  it("keeps the numbers of components the model kept and numbers new ones after them", () => {
    const d = built();
    const graph = {
      ...d.graph,
      nodes: [
        ...d.graph.nodes.filter((n) => n.id !== "server"),
        { id: "cache", label: "Cache", kind: "cache" as const, status: "normal" as const },
      ],
      edges: [],
    };
    const adopted = adoptGraph(d, graph);
    expect(adopted.nodeNo["client"]).toBe(d.nodeNo["client"]);
    expect(adopted.nodeNo["database"]).toBe(d.nodeNo["database"]);
    expect(adopted.nodeNo["cache"]).toBe(4);
    expect(adopted.nodeNo["server"]).toBeUndefined();
    expect(adopted.fresh).toEqual(["cache"]);
    expect(adopted.nextNo).toBe(5);
    expect(adopted.phase).toBe(d.phase);
  });

  it("can move to another phase when it adopts a drawing made from notes", () => {
    expect(adoptGraph(newDraft("think"), built().graph, "edit").phase).toBe("edit");
  });

  it("says a component already is that kind instead of pretending to change it", () => {
    const { results } = run(["3 is a database"], built());
    expect(results[0]).toEqual({ kind: "nothing", echo: ["Database already is a database"] });
  });
});

describe("saying what a model fix changed", () => {
  it("lists what was added, removed, renamed and altered, and nothing when nothing changed", () => {
    const before = run([
      "client, server, database",
      "connections",
      "client to server",
      "server to database",
    ]).draft;
    expect(graphChange(before.graph, before.graph)).toBe("");
    const after = run(
      ["edit", "rename 2 to API", "delete connection 2", "reverse 1"],
      before,
    ).draft;
    expect(graphChange(before.graph, after.graph)).toBe(
      "renamed API; removed 1 connection; changed 1 connection",
    );
  });
});

describe("robustness", () => {
  it("never throws and always leaves a valid graph, whatever is said", () => {
    const pieces = [
      "client",
      "server",
      "to",
      "and",
      "from",
      "returns html",
      "1",
      "2",
      "delete",
      "rename",
      "reverse",
      "node",
      "connection",
      "dashed",
      "database",
      ",",
      "group",
      "as",
      "x",
      "is a cache",
      "title",
      "undo",
      "done",
      "think",
      "connections",
      "edit",
      "components",
      "7",
      "with",
      "the",
    ];
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let round = 0; round < 400; round++) {
      let d = newDraft();
      for (let turn = 0; turn < 8; turn++) {
        const n = 1 + Math.floor(rnd() * 6);
        const text = Array.from(
          { length: n },
          () => pieces[Math.floor(rnd() * pieces.length)],
        ).join(" ");
        const r = step(d, text);
        if (r.kind === "applied") d = r.draft;
        if (r.kind === "ask" && r.options[0]) d = r.options[0].draft;
        expect(checkGraph(d.graph)).toEqual([]);
      }
    }
  });
});
