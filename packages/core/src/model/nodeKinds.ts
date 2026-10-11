import type { Graph, NodeKind } from "./graph";

/**
 * What a component of a diagram is, from its name: "Kafka" is a queue, "Redis" a cache, "CloudFront" a CDN. The kind decides how
 * the node is drawn (a cylinder for a database, a pipe for a queue, a cloud for a CDN, ...), so a diagram of an architecture
 * reads at a glance, also in black and white. A person's word or the model's choice always wins; this only fills in a generic
 * `service` or `process` (or nothing) with the more specific kind the name gives away.
 *
 * Specific kinds first: "Cache Server" is a cache, "Order Database" a database, "API Gateway" a gateway.
 */
const SPECIFIC: readonly (readonly [RegExp, NodeKind])[] = [
  [/\b(load ?balancers?|lbs?|alb|elb|nlb|nginx|haproxy|traefik|reverse proxy)\b/i, "loadbalancer"],
  [/\b(api ?gateways?|gateways?|kong|apigee|envoy)\b/i, "gateway"],
  [/\b(cdn|cloudfront|cloudflare|akamai|fastly|edge cache)\b/i, "cdn"],
  [/\b(redis|memcached?|elasticache|varnish|hazelcast|caches?|caching)\b/i, "cache"],
  [
    /\b(queues?|kafka|sqs|sns|rabbit(?:mq)?|activemq|nats|pulsar|kinesis|pub ?sub|streams?|topics?|brokers?|event bus|message bus|mq)\b/i,
    "queue",
  ],
  [
    /\b(s3|gcs|buckets?|blobs?|object stor(?:e|age)|minio|hdfs|efs|storage|disks?|file ?system)\b/i,
    "storage",
  ],
  [
    /\b(databases?|dbs?|postgres(?:ql)?|mysql|mariadb|mongo(?:db)?|dynamo(?:db)?|cassandra|scylla|cockroach(?:db)?|sql|nosql|sqlite|datastore|data store|warehouse|elasticsearch|opensearch|solr|bigtable|spanner|rds|aurora|clickhouse|snowflake|bigquery|couchdb|neo4j)\b/i,
    "datastore",
  ],
  [
    /\b(dns|route ?53|third[- ]party|external|stripe|oauth|smtp|email service|resolver)\b/i,
    "external",
  ],
];

/** Then the broad ones, which are only used when nothing else is known. */
const BROAD: readonly (readonly [RegExp, NodeKind])[] = [
  [/\b(client|browser|mobile|app|frontend|front end|web app|ui|device)\b/i, "client"],
  [/\b(user|customer|person|admin|actor|visitor)\b/i, "actor"],
  [/\b(decision|check|condition|if)\b/i, "decision"],
  [
    /\b(server|service|api|backend|back end|worker|lambda|function|microservice|app server|web server|consumers?|producers?|subscribers?|publishers?|processors?|handlers?)\b/i,
    "service",
  ],
];

/** "Kafka consumer", "Redis client" and "queue worker" are programs that use the thing, not the thing. */
const USES_IT =
  /\b(consumers?|producers?|subscribers?|publishers?|processors?|handlers?|workers?|clients?|sdk|drivers?|connectors?|libraries|library)\b/i;

const first = (
  rules: readonly (readonly [RegExp, NodeKind])[],
  name: string,
): NodeKind | undefined => {
  for (const [rule, kind] of rules) if (rule.test(name)) return kind;
  return undefined;
};

/** The specific kind a name gives away, if any ("Kafka" is a queue, "Web Server" gives none). */
export function specificKind(name: string): NodeKind | undefined {
  return USES_IT.test(name) ? undefined : first(SPECIFIC, name);
}

/** A first guess at what a component is, from its name. Wrong guesses are cheap: "3 is a database". */
export function inferKind(name: string): NodeKind {
  return specificKind(name) ?? first(BROAD, name) ?? "process";
}

/** The kinds a model uses when it has nothing more precise to say. */
const GENERIC: ReadonlySet<NodeKind> = new Set<NodeKind>(["service", "process"]);

/**
 * The kind a new node gets. A specific kind given by a person or the model stays; a generic one (or none) is made specific
 * when the name gives it away.
 */
export function refineKind(kind: NodeKind | undefined, name: string): NodeKind {
  if (kind !== undefined && !GENERIC.has(kind)) return kind;
  const specific = specificKind(name);
  if (specific !== undefined) return specific;
  return kind ?? inferKind(name);
}

/**
 * The nodes a model or a person has just added to a diagram (the ones `before` does not have) get the kind their name gives
 * away: "Kafka" in the Input notation, or a patch that says `kafka [service]: Kafka`, becomes a queue. Nodes that were
 * already there are never touched. Used where text from a model enters the document, not in the model itself, so printing
 * a diagram and reading it back stays exact.
 */
export function refineNewNodeKinds(before: Graph | undefined, after: Graph): Graph {
  const known = new Set((before?.nodes ?? []).map((n) => n.id));
  const nodes = after.nodes.map((n) => {
    if (known.has(n.id)) return n;
    const kind = refineKind(n.kind, n.label);
    return kind === n.kind ? n : { ...n, kind };
  });
  return nodes.some((n, i) => n !== after.nodes[i]) ? { ...after, nodes } : after;
}
