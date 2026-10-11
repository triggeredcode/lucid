import type { Case } from "../types";

/**
 * Input Mode: rough thoughts in, structured notes out. A case says what a good
 * answer must have and must not have, never an exact string. Variants are how the same words arrive from speech
 * recognition: lower case without punctuation, or with fillers.
 */
export const INPUT_CASES: Case[] = [
  // ------------------------------------------------------------------------------------ input_structure
  {
    id: "struct-load-balancer",
    category: "input_structure",
    mode: "input",
    doc: "empty",
    why: "Acceptance A: rough dictation becomes readable notes without the person naming headings or bullets.",
    utterance:
      "Load balancer. Multiple application servers behind it. Distribute incoming traffic. Health checks to avoid unhealthy servers. Database can become the bottleneck.",
    variants: [
      "load balancer multiple application servers behind it distribute incoming traffic health checks to avoid unhealthy servers database can become the bottleneck",
      "so um the load balancer sits in front of like multiple application servers and it distributes incoming traffic uh and does health checks to avoid unhealthy servers and the database can become the bottleneck",
    ],
    expect: {
      doc: {
        hasHeading: [{ text: "load balanc" }],
        contains: ["traffic", "health check", "database", "bottleneck"],
        blockCounts: { diagram: { eq: 0 }, table: { eq: 0 }, math: { eq: 0 } },
        noInventedNumbers: true,
      },
    },
  },
  {
    id: "struct-caching",
    category: "input_structure",
    mode: "input",
    doc: "empty",
    why: "A short explanation with a couple of points: headings and bullets, no diagram or table nobody asked for.",
    utterance:
      "Caching reduces latency. Redis keeps hot keys in memory. Cache invalidation is the hard part, TTLs help but can serve stale data.",
    variants: [
      "caching reduces latency redis keeps hot keys in memory cache invalidation is the hard part ttls help but can serve stale data",
    ],
    expect: {
      doc: {
        contains: ["latency", "redis", "invalidation", "stale"],
        blockCounts: { diagram: { eq: 0 }, table: { eq: 0 } },
      },
    },
  },
  {
    id: "struct-no-over-structuring",
    category: "input_structure",
    mode: "input",
    doc: "empty",
    why: "One idea in two sentences must not become a pile of headings and a diagram.",
    utterance:
      "Consistent hashing places keys and nodes on a ring, so adding a node only moves the keys next to it.",
    expect: {
      doc: {
        contains: ["ring", "node"],
        blockCounts: { diagram: { eq: 0 }, table: { eq: 0 }, heading: { max: 1 } },
      },
    },
  },
  {
    id: "struct-cap",
    category: "input_structure",
    mode: "input",
    doc: "empty",
    utterance:
      "The CAP theorem says a distributed store can only guarantee two of consistency, availability and partition tolerance. Partitions happen in practice so the real choice is between consistency and availability.",
    variants: [
      "the cap theorem says a distributed store can only guarantee two of consistency availability and partition tolerance partitions happen in practice so the real choice is between consistency and availability",
    ],
    expect: {
      doc: {
        contains: ["consistency", "availability", "partition"],
        blockCounts: { diagram: { eq: 0 }, table: { eq: 0 } },
      },
    },
  },

  // ------------------------------------------------------------------------------------ input_diagram
  {
    id: "diagram-request-flow",
    category: "input_diagram",
    mode: "input",
    doc: "empty",
    why: "Acceptance B: a request flow with DNS, a web server, a cache and a database becomes ONE diagram with the right parts and links.",
    utterance:
      "A client asks DNS for the IP address of the domain, and DNS answers. The client then sends the request to the web server. The web server checks Redis for the result. On a cache miss it queries PostgreSQL, stores the result in Redis and returns the response to the client.",
    variants: [
      "a client asks dns for the ip address of the domain and dns answers the client then sends the request to the web server the web server checks redis for the result on a cache miss it queries postgres stores the result in redis and returns the response to the client",
    ],
    expect: {
      doc: { blockCounts: { diagram: { eq: 1 } } },
      graph: {
        hasNodes: ["client", "DNS", "web server", "Redis", "PostgreSQL"],
        hasEdges: [
          { from: "client", to: "DNS" },
          { from: "client", to: "web server" },
          { from: "web server", to: "Redis" },
          { from: "web server", to: "PostgreSQL" },
        ],
        noUngroundedNodes: true,
      },
    },
  },
  {
    id: "diagram-kinds",
    category: "input_diagram",
    mode: "input",
    doc: "empty",
    why: "Reading a book on system design and dictating an architecture: each component is drawn as what it is (a database as a cylinder, a queue as a pipe, a CDN as a cloud, a gateway, a load balancer), from the words alone.",
    utterance:
      "The browser gets static files from a CDN. API calls go through a load balancer and an API gateway to the order service. The order service reads from Redis, queries PostgreSQL and publishes events to Kafka. A worker consumes the events from Kafka and saves the invoices in S3.",
    variants: [
      "the browser gets static files from a cdn api calls go through a load balancer and an api gateway to the order service the order service reads from redis queries postgres and publishes events to kafka a worker consumes the events from kafka and saves the invoices in s3",
    ],
    expect: {
      doc: { blockCounts: { diagram: { eq: 1 } } },
      graph: {
        hasNodes: [
          "CDN",
          "load balancer",
          "API gateway",
          "order service",
          "Redis",
          "PostgreSQL",
          "Kafka",
          "S3",
        ],
        kinds: [
          { label: "CDN", kind: "cdn" },
          { label: "load balancer", kind: "loadbalancer" },
          { label: "API gateway", kind: "gateway" },
          { label: "Redis", kind: "cache" },
          { label: "PostgreSQL", kind: "datastore" },
          { label: "Kafka", kind: "queue" },
          { label: "S3", kind: "storage" },
        ],
        noUngroundedNodes: true,
      },
    },
  },
  {
    id: "diagram-event-pipeline",
    category: "input_diagram",
    mode: "input",
    doc: "empty",
    utterance:
      "Producers publish events to Kafka. Two consumers read from Kafka: one writes the events to S3 and the other updates Elasticsearch.",
    expect: {
      doc: { blockCounts: { diagram: { eq: 1 } } },
      graph: {
        hasNodes: ["Kafka", "S3", "Elasticsearch"],
        hasEdges: [{ from: "producer", to: "Kafka" }],
        nodeCount: { min: 4, max: 7 },
        noUngroundedNodes: true,
      },
    },
  },
  {
    id: "diagram-login",
    category: "input_diagram",
    mode: "input",
    doc: "empty",
    utterance:
      "To log in, the browser sends the credentials to the auth service. The auth service checks the user database and returns a JWT to the browser.",
    expect: {
      doc: { blockCounts: { diagram: { eq: 1 } } },
      graph: {
        hasNodes: ["browser", "auth service", "user database"],
        hasEdges: [
          { from: "browser", to: "auth service" },
          { from: "auth service", to: "user database" },
        ],
        noUngroundedNodes: true,
      },
    },
  },

  // ------------------------------------------------------------------------------------ input_table
  {
    id: "table-sql-nosql",
    category: "input_table",
    mode: "input",
    doc: "empty",
    why: "Acceptance D: dictating the columns and the rows of a comparison gives exactly that table.",
    utterance:
      "Create a comparison table with three columns: property, SQL and NoSQL. The rows are schema, relationships, scaling, consistency and use cases.",
    variants: [
      "create a comparison table with three columns property sql and nosql the rows are schema relationships scaling consistency and use cases",
    ],
    expect: {
      doc: { blockCounts: { table: { eq: 1 } } },
      table: {
        columns: ["Property", "SQL", "NoSQL"],
        rowHeaders: ["Schema", "Relationships", "Scaling", "Consistency", "Use cases"],
        rowCount: { eq: 5 },
      },
    },
  },
  {
    id: "table-create-spec-wording",
    category: "input_table",
    mode: "input",
    doc: "empty",
    why: "Acceptance D, in the words of the spec and as a person says them: an explicit request to create a table, with its columns and rows named, is content for Input Mode (a table with the cells left empty), not a command.",
    utterance:
      "Create a comparison table. Three columns: property, SQL, NoSQL. Rows: schema, relationships, scaling, consistency, and use cases.",
    variants: [
      "Make a table comparing SQL and NoSQL. Columns are property, SQL and NoSQL. Rows are schema, relationships, scaling, consistency and use cases.",
      "create a comparison table. three columns: property, SQL, NoSQL. rows: schema, relationships, scaling, consistency and use cases",
      "Let's build a comparison table. The columns are property, SQL, NoSQL, and the rows are schema, relationships, scaling, consistency, use cases.",
    ],
    expect: {
      doc: { blockCounts: { table: { eq: 1 } } },
      table: {
        columns: ["Property", "SQL", "NoSQL"],
        rowHeaders: ["Schema", "Relationships", "Scaling", "Consistency", "Use cases"],
        rowCount: { eq: 5 },
      },
    },
  },
  {
    id: "table-kafka-rabbitmq",
    category: "input_table",
    mode: "input",
    doc: "empty",
    utterance: "Compare Kafka and RabbitMQ on ordering, throughput and persistence.",
    expect: {
      doc: { blockCounts: { table: { eq: 1 } } },
      table: {
        cellsContain: ["Kafka", "RabbitMQ"],
        rowHeaders: ["Ordering", "Throughput", "Persistence"],
        rowCount: { eq: 3 },
      },
    },
  },

  // ------------------------------------------------------------------------------------ input_math
  {
    id: "math-kv-cache",
    category: "input_math",
    mode: "input",
    doc: "empty",
    utterance:
      "KV cache size is two times the number of layers times the number of KV heads times the head dimension times the bytes per element times the sequence length.",
    expect: { doc: { hasMath: true, noInventedNumbers: true } },
  },
  {
    id: "math-decode-bandwidth",
    category: "input_math",
    mode: "input",
    doc: "empty",
    utterance:
      "Decoding is memory bandwidth bound: tokens per second is roughly the memory bandwidth divided by the model size in bytes.",
    expect: { doc: { hasMath: true, contains: ["bandwidth"], noInventedNumbers: true } },
  },

  // ------------------------------------------------------------------------------------ input_placement
  {
    id: "placement-append-to-list",
    category: "input_placement",
    mode: "input",
    doc: "db-options",
    focus: "list",
    why: "More of the same kind of thing goes into the list the person is in, not into a new block.",
    utterance: "Also Cassandra.",
    expect: {
      doc: {
        listItems: ["PostgreSQL", "MongoDB", "DynamoDB", "Cassandra"],
        listItemCount: { eq: 4 },
      },
    },
  },
  {
    id: "placement-append-row",
    category: "input_placement",
    mode: "input",
    doc: "two-tables",
    focus: { type: "table", nth: 1 },
    utterance: "Also a row for cost: Kafka needs your own infrastructure, SQS is pay per request.",
    expect: {
      touchedOnly: [{ type: "table", nth: 1 }],
      table: { on: { type: "table", nth: 1 }, rowCount: { eq: 3 } },
    },
  },

  // ------------------------------------------------------------------------------------ stt_noise
  {
    id: "stt-misheard-names",
    category: "stt_noise",
    mode: "input",
    doc: "empty",
    why: "Speech recognition writes names as it hears them; the notes use the names people mean.",
    utterance:
      "We store the data in post gress and cache the hot rows in red is. Writes go through cough ka.",
    expect: {
      doc: {
        contains: ["postgres", "redis", "kafka"],
        lacks: ["post gress", "red is", "cough ka"],
      },
    },
  },
  {
    id: "stt-fillers",
    category: "stt_noise",
    mode: "input",
    doc: "empty",
    utterance:
      "So um the load balancer sends traffic to the uh application servers and like it does health checks.",
    expect: {
      doc: { contains: ["load balancer", "health check"], lacks: ["uh", "um the", "like it"] },
    },
  },

  // ------------------------------------------------------------------------------------ benchmark_numbers
  {
    id: "numbers-decode-speed",
    category: "benchmark_numbers",
    mode: "input",
    doc: "empty",
    why: "Numbers come from what was said and nowhere else.",
    utterance:
      "On my Mac the 27B model decodes at 9.7 tokens per second and the 31B model at 17.7 tokens per second.",
    expect: {
      doc: {
        contains: ["9.7", "17.7"],
        noInventedNumbers: true,
        blockCounts: { diagram: { eq: 0 } },
      },
    },
  },
  {
    id: "numbers-latency",
    category: "benchmark_numbers",
    mode: "input",
    doc: "empty",
    utterance:
      "With batching off the p50 latency was 120 milliseconds, with batch size eight it went to 310 milliseconds but throughput tripled.",
    expect: { doc: { contains: ["120", "310"], noInventedNumbers: true } },
  },

  // ------------------------------------------------------------------------------------ grounding_adversarial
  {
    id: "grounding-three-parts",
    category: "grounding_adversarial",
    mode: "input",
    doc: "empty",
    why: "Draw only what was said: three parts mentioned, three parts drawn.",
    utterance:
      "Draw the architecture: a client talks to a web server, and the web server talks to a database.",
    expect: {
      graph: {
        hasNodes: ["client", "web server", "database"],
        nodeCount: { min: 3, max: 3 },
        noUngroundedNodes: true,
      },
    },
  },
  {
    id: "grounding-no-extras-in-notes",
    category: "grounding_adversarial",
    mode: "input",
    doc: "empty",
    utterance: "Rate limiting protects the API from abusive clients.",
    expect: {
      doc: {
        contains: ["rate limit", "abusive"],
        blockCounts: { diagram: { eq: 0 }, table: { eq: 0 } },
        noInventedNumbers: true,
      },
    },
  },

  // ------------------------------------------------------------------------------------ mode_separation
  {
    id: "mode-content-that-sounds-like-a-command",
    category: "mode_separation",
    mode: "input",
    doc: "lb-points",
    why: "Acceptance G: words about deleting are a note in Input Mode, never a deletion.",
    utterance: "Then we delete the old cache entries after thirty days.",
    variants: ["then we delete the old cache entries after thirty days it keeps memory in check"],
    expect: {
      touchedOnly: [],
      doc: { contains: ["delete", "thirty"], listItemCount: { min: 3 } },
    },
  },
  {
    id: "mode-instruction-in-input",
    category: "mode_separation",
    mode: "input",
    doc: "db-options",
    focus: "list",
    why: "An instruction said in Input Mode is recognised, not written down as a note and not carried out.",
    utterance: "Cross out MongoDB.",
    expect: { outcome: "command" },
  },
  {
    id: "mode-advice-is-content",
    category: "mode_separation",
    mode: "input",
    doc: "empty",
    utterance: "We should remove single points of failure by adding a second load balancer.",
    expect: { doc: { contains: ["single point", "load balancer"] } },
  },
];
