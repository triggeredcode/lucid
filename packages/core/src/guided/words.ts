import type { NodeKind } from "../model/graph";
export { inferKind } from "../model/nodeKinds";

/** Small helpers for reading spoken diagram and table descriptions. */

const NUMBER_WORDS: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
  fifth: 5,
  sixth: 6,
  seventh: 7,
  eighth: 8,
  ninth: 9,
  tenth: 10,
};

/** "3", "three", "third" and "number three" as a number; undefined for anything else. */
export function parseNumber(text: string): number | undefined {
  const t = text
    .trim()
    .toLowerCase()
    .replace(/^(?:number|no\.?|#)\s*/, "");
  if (/^\d{1,3}$/.test(t)) return Number(t);
  return NUMBER_WORDS[t];
}

/** Words that carry no meaning when speaking a list or a link. */
const FILLER =
  /^(?:um+|uh+|er+|ah+|okay|ok|so|like|please|now|well|alright|right|yeah|basically)$/i;

/** Lower-case words of an utterance in their original case, with filler and punctuation removed. */
export function words(text: string): string[] {
  return text
    .replace(/[“”"]/g, "")
    .replace(/[’]/g, "'")
    .replace(/→|=>|->/g, " to ")
    .replace(/[.!?:]+(?=\s|$)/g, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^[([]+|[)\]]+$/g, ""))
    .filter((w) => w.length > 0 && !FILLER.test(w));
}

const PROPER: Record<string, string> = {
  postgres: "PostgreSQL",
  postgresql: "PostgreSQL",
  mysql: "MySQL",
  mongodb: "MongoDB",
  mongo: "MongoDB",
  dynamodb: "DynamoDB",
  dynamo: "DynamoDB",
  redis: "Redis",
  memcached: "Memcached",
  kafka: "Kafka",
  rabbitmq: "RabbitMQ",
  sqs: "SQS",
  sns: "SNS",
  s3: "S3",
  cdn: "CDN",
  dns: "DNS",
  api: "API",
  db: "DB",
  http: "HTTP",
  https: "HTTPS",
  tcp: "TCP",
  udp: "UDP",
  ip: "IP",
  url: "URL",
  ui: "UI",
  cpu: "CPU",
  gpu: "GPU",
  llm: "LLM",
  jwt: "JWT",
  tls: "TLS",
  ssl: "SSL",
  sql: "SQL",
  nosql: "NoSQL",
  aws: "AWS",
  gcp: "GCP",
  lb: "LB",
  mq: "MQ",
  kv: "KV",
  vllm: "vLLM",
  json: "JSON",
  html: "HTML",
  ec2: "EC2",
  k8s: "K8s",
};

/** "web server" becomes "Web Server", "dns" becomes "DNS", "postgres" becomes "PostgreSQL". */
export function titleCase(text: string): string {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map(
      (w) =>
        PROPER[w.toLowerCase()] ??
        (w === w.toUpperCase() && w.length > 1 ? w : w.charAt(0).toUpperCase() + w.slice(1)),
    )
    .join(" ");
}

/** The kind a person means by a spoken word ("database", "db", "queue", ...). */
export function kindFromWord(word: string): NodeKind | undefined {
  const w = word.trim().toLowerCase();
  const map: Record<string, NodeKind> = {
    client: "client",
    user: "actor",
    actor: "actor",
    server: "service",
    service: "service",
    database: "datastore",
    db: "datastore",
    datastore: "datastore",
    cache: "cache",
    queue: "queue",
    cdn: "cdn",
    gateway: "gateway",
    "load balancer": "loadbalancer",
    loadbalancer: "loadbalancer",
    external: "external",
    storage: "storage",
    decision: "decision",
    process: "process",
    note: "note",
  };
  return map[w];
}

/** A short identifier for a component: "Web Server" becomes web_server, unique among `taken`. */
export function slugFor(label: string, taken: ReadonlySet<string>): string {
  let base = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 28);
  if (!/^[a-z]/.test(base)) base = `n_${base}`.replace(/_+$/, "");
  if (base.length === 0) base = "node";
  let slug = base;
  for (let i = 2; taken.has(slug); i++) slug = `${base}_${String(i)}`.slice(0, 32);
  return slug;
}
