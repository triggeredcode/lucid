import { describe, expect, it } from "vitest";
import { emptyGraph } from "./graph";
import { addNode } from "./graphOps";
import { inferKind, refineKind, refineNewNodeKinds, specificKind } from "./nodeKinds";

describe("what a name gives away", () => {
  it.each([
    ["Kafka", "queue"],
    ["Amazon SQS", "queue"],
    ["RabbitMQ", "queue"],
    ["Message Queue", "queue"],
    ["Redis", "cache"],
    ["Memcached", "cache"],
    ["Cache Server", "cache"],
    ["PostgreSQL", "datastore"],
    ["Orders Database", "datastore"],
    ["DynamoDB", "datastore"],
    ["Elasticsearch", "datastore"],
    ["S3", "storage"],
    ["Object Storage", "storage"],
    ["CloudFront", "cdn"],
    ["CDN", "cdn"],
    ["API Gateway", "gateway"],
    ["Kong", "gateway"],
    ["Load Balancer", "loadbalancer"],
    ["Nginx", "loadbalancer"],
    ["DNS", "external"],
    ["Stripe", "external"],
  ] as const)("%s is a %s", (name, kind) => {
    expect(specificKind(name)).toBe(kind);
  });

  it.each([
    "Web Server",
    "Order Service",
    "Browser",
    "User",
    "Kafka consumer",
    "Redis client",
    "Queue worker",
    "Event handler",
  ])("%s gives away nothing specific (it is a program that uses the thing)", (name) => {
    expect(specificKind(name)).toBeUndefined();
  });

  it("falls back on the broad kinds, and on a process", () => {
    expect(inferKind("Web Server")).toBe("service");
    expect(inferKind("Browser")).toBe("client");
    expect(inferKind("Customer")).toBe("actor");
    expect(inferKind("Kafka consumer")).toBe("service");
    expect(inferKind("Mystery box")).toBe("process");
  });
});

describe("refineKind", () => {
  it("keeps a specific kind that was given, whatever the name says", () => {
    expect(refineKind("datastore", "Redis")).toBe("datastore");
    expect(refineKind("client", "Kafka")).toBe("client");
    expect(refineKind("decision", "Database ok?")).toBe("decision");
  });

  it("makes a generic kind specific when the name gives it away", () => {
    expect(refineKind("service", "Kafka")).toBe("queue");
    expect(refineKind("process", "CloudFront")).toBe("cdn");
    expect(refineKind("service", "Web Server")).toBe("service");
  });

  it("guesses from the name when there is no kind", () => {
    expect(refineKind(undefined, "Kafka")).toBe("queue");
    expect(refineKind(undefined, "Web Server")).toBe("service");
    expect(refineKind(undefined, "Whatever")).toBe("process");
  });
});

describe("refineNewNodeKinds", () => {
  const base = addNode(emptyGraph(), { id: "kafka", label: "Kafka", kind: "service" });
  const after = addNode(addNode(base, { id: "cdn", label: "CloudFront", kind: "service" }), {
    id: "web",
    label: "Web Server",
    kind: "service",
  });

  it("changes only the nodes that were just added", () => {
    const refined = refineNewNodeKinds(base, after);
    const kinds = Object.fromEntries(refined.nodes.map((n) => [n.id, n.kind]));
    // Kafka was already there as a service: not touched. The CDN is new: refined.
    expect(kinds).toEqual({ kafka: "service", cdn: "cdn", web: "service" });
  });

  it("with no earlier version, treats every node as new", () => {
    const kinds = refineNewNodeKinds(undefined, after).nodes.map((n) => n.kind);
    expect(kinds).toEqual(["queue", "cdn", "service"]);
  });

  it("returns the same graph when nothing changes", () => {
    const plain = addNode(emptyGraph(), { id: "web", label: "Web Server", kind: "service" });
    expect(refineNewNodeKinds(undefined, plain)).toBe(plain);
  });
});
