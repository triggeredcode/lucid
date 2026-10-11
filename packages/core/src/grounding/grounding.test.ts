import { describe, expect, it } from "vitest";
import { bullets, doc, h2, p } from "../testing";
import {
  aliasKey,
  contentWords,
  coverage,
  inventedNumbers,
  plainTextOfBlocks,
  sameTerm,
  stem,
  ungroundedTerms,
} from "./index";

describe("words", () => {
  it("stems plurals and endings to one form", () => {
    expect(stem("servers")).toBe(stem("server"));
    expect(stem("caching")).toBe(stem("cache"));
    expect(stem("queries")).toBe(stem("query"));
    expect(stem("distributed")).toBe(stem("distribute"));
  });

  it("keeps content words and drops fillers", () => {
    expect(
      contentWords("Um, so like, the load balancer distributes incoming traffic, you know"),
    ).toEqual(["load", "balancer", stem("distribute"), stem("incoming"), "traffic"]);
  });
});

describe("aliases", () => {
  it("treats spoken and written variants as one term", () => {
    expect(sameTerm("Postgres", "PostgreSQL")).toBe(true);
    expect(sameTerm("red is", "Redis")).toBe(true);
    expect(sameTerm("K8s", "Kubernetes")).toBe(true);
    expect(sameTerm("Redis", "Kafka")).toBe(false);
    expect(aliasKey("Foobar")).toBe("foobar");
  });
});

describe("coverage", () => {
  const said =
    "Load balancer. Multiple application servers behind it. Distribute incoming traffic. Health checks to avoid unhealthy servers. Database can become the bottleneck.";

  it("is full when the notes keep the content", () => {
    const out =
      "## Load Balancer\nA load balancer sits in front of multiple application servers and distributes incoming traffic.\n- **Health checks** keep traffic away from unhealthy servers.\n- The **database** can become the bottleneck.";
    const c = coverage(said, out);
    expect(c.ratio).toBeGreaterThanOrEqual(0.8);
    expect(c.missing).toEqual(["behind", "avoid"]);
  });

  it("lists what was dropped", () => {
    const c = coverage(said, "A load balancer distributes traffic.");
    expect(c.ratio).toBeLessThan(0.6);
    expect(c.missing).toEqual(expect.arrayContaining(["health", "bottleneck"]));
  });

  it("counts a corrected technical term as covered", () => {
    expect(coverage("we cache it in red is", "Cache results in Redis").missing).toEqual([]);
  });

  it("does not ask for the words that describe the notes themselves", () => {
    const said =
      "Create a comparison table. Three columns: property, SQL, NoSQL. Rows: schema, relationships, scaling, consistency, and use cases.";
    const table =
      "SQL vs NoSQL\nProperty\nSQL\nNoSQL\nSchema\nRelationships\nScaling\nConsistency\nUse cases";
    expect(coverage(said, table)).toEqual({ ratio: 1, missing: [] });
  });

  it("is 1 when there is nothing to cover", () => {
    expect(coverage("um uh", "").ratio).toBe(1);
  });
});

describe("inventedNumbers", () => {
  it("reports numbers the speaker never said", () => {
    expect(
      inventedNumbers("Handles 10,000 requests per second", ["it handles 5000 requests"]),
    ).toEqual(["10000"]);
  });

  it("accepts numbers from the utterance or the document, in any format", () => {
    expect(inventedNumbers("15.1 tok/s and 100M URLs", ["decode 15.10 tok/s"])).toEqual(["100m"]);
    expect(inventedNumbers("17.7 tok/s", ["gemma did 17.7"])).toEqual([]);
    expect(inventedNumbers("1,000 users", ["a base of 1000 users"])).toEqual([]);
  });

  it("ignores digits inside names", () => {
    expect(inventedNumbers("Use Base62 with S3 and gpt4", [])).toEqual([]);
  });

  it("does not judge when numbers were spoken as words", () => {
    expect(inventedNumbers("100 million URLs a day", ["a hundred million URLs a day"])).toEqual([]);
  });
});

describe("ungroundedTerms", () => {
  const spoken = [
    "The client sends a request to the web server. The web server checks Redis and then Postgres.",
  ];
  it("accepts terms that were said, in other forms", () => {
    expect(ungroundedTerms(["Web Server", "Redis", "PostgreSQL", "Client"], spoken)).toEqual([]);
  });
  it("flags terms that were not", () => {
    expect(ungroundedTerms(["CDN", "Web Server", "Message Queue"], spoken)).toEqual([
      "CDN",
      "Message Queue",
    ]);
  });
});

describe("plainTextOfBlocks", () => {
  it("collects text from every kind of block", () => {
    const d = doc(h2("Caching"), p("Redis helps"), bullets("hot keys"));
    expect(plainTextOfBlocks(d.blocks)).toBe("Caching\nRedis helps\nhot keys");
  });
});
