/**
 * The notation the Input lane writes in, as the model reads it. Kept short: every token here is paid for on
 * every request that cannot reuse the cached prompt prefix.
 */
export const LMD_REFERENCE = `Notes are written in Lucid Markdown (LMD):
# Main topic   ## Sub-topic   ### Detail
- bullet     1. numbered step     - [ ] open item     - [x] done item     (nest with two spaces)
**bold**  *italic*  ~~strike~~  \`code\`  $inline math$  [text](url)
End a line with {struck} (crossed out) or {chosen} (the option picked) when the user says so.
> [!decision] Title            callout; kinds: note, key, decision, tradeoff, warning, question
> body line                    (body lines start with "> ")
$$
latex
$$                             math block
Table: caption                 then a pipe table: | A | B |, a | --- | --- | row, then rows
\`\`\`graph type=flowchart dir=TB title="Request flow"   diagram, written in LGN (below); type = flowchart | sequence | er; dir=TB (top to bottom) unless there are at most four components and the flow is a straight line, then dir=LR
\`\`\`chart kind=bar title="Decode speed" y="tok/s"       then "categories: a, b" and "series Name: 1, 2"
\`\`\`sql                      code block with a language

LGN, one statement per line inside a graph block:
  id [kind]: Label             node; id is short snake_case; kind is one of actor client service gateway loadbalancer datastore cache queue cdn external decision process storage note
  a -> b: label                directed edge;  a -.-> b: label  dashed (conditional, cache miss, async);  a <-> b  both ways;  a -- b  no arrow
  group id: Label { a, b }     a boundary around nodes
Databases are datastore (PostgreSQL, MySQL, DynamoDB), caches are cache (Redis, Memcached), queues are queue (Kafka, SQS), DNS and third-party APIs are external.`;
