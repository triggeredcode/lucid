import { describe, expect, it } from "vitest";
import { applyLgn, parseLgn, type LgnOptions } from "./apply";
import { printLgn } from "./print";

/**
 * Golden samples for LGN. Each sample's canonical output is
 * stored in __golden__/<name>.txt: for valid input the graph header plus the printed LGN, for invalid input
 * the list of errors. Review the .txt files in the diff whenever one changes.
 */

interface Sample {
  source: string;
  options?: LgnOptions;
}

const REQUEST_FLOW = `user [actor]: User
client [client]: Client
dns [external]: DNS
web [service]: Web Server
redis [cache]: Redis
pg [datastore]: PostgreSQL
user -> client: enters domain
client -> dns: resolve domain
dns -> client: IP address
client -> web: HTTP request
web -> redis: check cache
web -.-> pg: cache miss: query
pg -.-> web: data
web -.-> redis: store result
web -> client: JSON response`;

const VALID: Record<string, Sample> = {
  "01-request-flow": { source: REQUEST_FLOW, options: { title: "Request flow" } },
  "02-sequence-cache-alt": {
    options: { type: "sequence", title: "Cache lookup" },
    source: `client [client]: Client
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
web -.-> client: JSON`,
  },
  "03-sequence-nested-fragments": {
    options: { type: "sequence" },
    source: `a [actor]: Caller
b [service]: Service
loop retry up to 3 times
a -> b: request
opt service is busy
b -.-> a: 503
end
b -.-> a: 200
end`,
  },
  "04-groups": {
    options: { direction: "TB" },
    source: `lb [loadbalancer]: Load Balancer
app1 [service]: App 1
app2 [service]: App 2
db [datastore]: Primary DB
lb -> app1
lb -> app2
app1 -> db
app2 -> db
group tier: Application tier {app1, app2}
group data: Data tier {db} {struck}`,
  },
  "05-statuses": {
    source: `pg [datastore]: PostgreSQL {struck}
mongo [datastore]: MongoDB {struck}
dynamo [datastore]: DynamoDB {chosen}
secret [process]: Internal detail {hidden}
app [service]: App
app -> pg: considered {struck}
app -> mongo: considered {struck}
app -> dynamo: chosen {chosen}
app -> secret {hidden}`,
  },
  "06-all-arrows": {
    source: `a -> b
b -- c
c <-> d
d -.-> e
e -.- f
f <-.-> g
g ..> h
h ... i
i <..> a`,
  },
  "07-special-labels": {
    source: `issue [service]: Issue #42 tracker
p [process]: Postgres: primary
q [process]: "  padded label  "
r [process]: "ends with {struck}"
s [process]: "say \\"hi\\""
issue -> p: "writes: batched"
p -> q: replicate # async`,
  },
  "08-auto-declared": {
    source: `web_server -> api_gateway: proxies\napi_gateway [gateway]: API Gateway\napi_gateway -> auth_service`,
  },
  "09-er-diagram": {
    options: { type: "er" },
    source: `user [storage]: USER
url [storage]: URL
click [storage]: CLICK
user -> url: creates (one to many)
url -> click: receives (one to many)`,
  },
  "10-decision-flow": {
    options: { direction: "TB", title: "Cache decision" },
    source: `start [actor]: Request arrives
check [decision]: Cache hit?
respond [process]: Return cached value
load [process]: Load from database
store [process]: Write to cache
start -> check
check -> respond: yes
check -> load: no
load -> store
store -> respond`,
  },
  "11-inference-pipeline": {
    options: { title: "LLM serving path" },
    source: `gw [gateway]: API Gateway
sched [service]: Scheduler
prefill [service]: Prefill workers
decode [service]: Decode workers
kv [cache]: KV cache
gpu [storage]: GPU HBM
gw -> sched: request
sched -> prefill: new prompt
prefill -> kv: write KV blocks
sched -> decode: continuing sequence
decode -> kv: read KV blocks
kv -- gpu
group workers: GPU workers {prefill, decode}`,
  },
  "12-single-node": { source: "web [service]: Web Server" },
  "13-comments-and-blank-lines": {
    source: `# the cache path

web [service]: Web
  # indented comment
redis [cache]: Redis

web -> redis: get`,
  },
  "14-parallel-edges": {
    source: `web -> redis: check cache
web -.-> redis: store result
web -> redis: check cache
web -> pg
web -> pg: query`,
  },
  "15-empty": { source: "" },
};

const INVALID: Record<string, Sample> = {
  "e1-look-alike-arrow": { source: "client => server\nserver --> client" },
  "e2-unknown-kind": { source: "db [database]: Database\nweb [service]: Web" },
  "e3-bad-id-with-spaces": { source: "Web Server [service]: Web" },
  "e4-unclosed-fragment": {
    options: { type: "sequence" },
    source: "a -> b\nalt cache hit\nb -> a",
  },
  "e5-unknown-group-member": { source: "a [service]: A\ngroup g: Group {a, ghost}" },
  "e6-fragment-in-flowchart": { source: "a -> b\nloop forever\nb -> a\nend" },
  "e7-several-errors-in-order": {
    source: "ok [service]: Fine\nbad => x\nalso [nope]: bad\nfine -> ok\ngroup g: G {}\nx".repeat(
      1,
    ),
  },
};

const header = (options: LgnOptions | undefined): string =>
  `type=${options?.type ?? "flowchart"} direction=${options?.direction ?? "LR"}${options?.title ? ` title="${options.title}"` : ""}`;

describe("LGN golden samples (valid)", () => {
  for (const [name, sample] of Object.entries(VALID)) {
    it(name, async () => {
      const result = parseLgn(sample.source, sample.options);
      expect(result.ok, JSON.stringify(!result.ok && result.errors)).toBe(true);
      if (!result.ok) return;
      await expect(
        `${header(sample.options)}\n---\n${printLgn(result.graph)}\n`,
      ).toMatchFileSnapshot(`./__golden__/${name}.txt`);
    });
  }

  it("16-patch-existing-graph", async () => {
    const base = parseLgn(REQUEST_FLOW);
    if (!base.ok) throw new Error("base failed");
    const patched = applyLgn(
      base.graph,
      "# strike Redis, add the cache-hit path and a CDN\nredis {struck}\nredis -> web: cache hit: cached data\ncdn [cdn]: CDN\ncdn -> web",
    );
    expect(patched.ok).toBe(true);
    if (!patched.ok) return;
    await expect(`patch\n---\n${printLgn(patched.graph)}\n`).toMatchFileSnapshot(
      "./__golden__/16-patch-existing-graph.txt",
    );
  });
});

describe("LGN golden samples (errors)", () => {
  for (const [name, sample] of Object.entries(INVALID)) {
    it(name, async () => {
      const result = parseLgn(sample.source, sample.options);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      const text = result.errors.map((e) => `line ${String(e.line)}: ${e.message}`).join("\n");
      await expect(`${header(sample.options)}\n---\n${text}\n`).toMatchFileSnapshot(
        `./__golden__/${name}.txt`,
      );
    });
  }
});
