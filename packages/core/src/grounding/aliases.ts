/**
 * Spoken and written variants of technical terms. Used to decide whether "Postgres" in the notes
 * is grounded in "PostgreSQL" in the utterance. Lowercase, letters and digits only.
 */
const GROUPS: readonly (readonly string[])[] = [
  ["postgres", "postgresql", "pg", "post gress", "postgress", "post gres"],
  ["mongo", "mongodb", "mongo db"],
  ["dynamo", "dynamodb", "dynamo db"],
  ["mysql", "my sql", "my sequel"],
  ["sql", "sequel"],
  ["nosql", "no sql", "non relational"],
  ["redis", "red is", "reddis"],
  ["memcached", "memcache", "mem cached"],
  ["kafka", "apache kafka"],
  ["rabbitmq", "rabbit mq", "rabbit"],
  ["lb", "load balancer", "loadbalancer", "load balancing"],
  ["api gateway", "api gw", "apigw", "gateway"],
  ["k8s", "kubernetes", "kube"],
  ["cdn", "content delivery network"],
  ["dns", "domain name system", "domain name service"],
  ["s3", "object storage", "blob storage"],
  ["vllm", "v llm", "vlm"],
  ["kv cache", "key value cache", "kvcache"],
  ["gpu", "gpus"],
  ["llm", "large language model", "language model"],
  ["tps", "tokens per second", "tok s", "tok/s"],
  ["ttft", "time to first token"],
  ["acid", "acid transactions"],
  ["cap theorem", "cap"],
];

const lookup = new Map<string, number>();
GROUPS.forEach((group, i) => {
  for (const term of group) lookup.set(normaliseTerm(term), i);
});

export function normaliseTerm(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** A canonical key: equal for aliases of each other. Terms with no alias are their own key. */
export function aliasKey(text: string): string {
  const n = normaliseTerm(text);
  const group = lookup.get(n);
  return group === undefined ? n : `#${String(group)}`;
}

export const sameTerm = (a: string, b: string): boolean => aliasKey(a) === aliasKey(b);
