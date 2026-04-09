# The Telemetry Constitution

## A Comprehensive Guide to Modern Application Observability

---

## Part 1: Philosophy and Mental Model

### 1.1 What Observability Actually Means

Observability is the ability to understand the internal state of a system by examining its external outputs — without deploying new code, without adding new instrumentation after the fact, and without knowing in advance what questions you'll need to ask.

This is fundamentally different from monitoring. Monitoring answers predefined questions: "Is CPU above 80%?" "Is the error rate above 1%?" These are known-unknowns — things you anticipated might go wrong. Observability answers questions you couldn't have predicted: "Why are premium customers in Germany experiencing slow checkouts, but only when the fraud-v2 feature flag is enabled, and only since yesterday's deploy?" These are unknown-unknowns — novel failure modes that emerge from the interaction of complex systems.

The distinction matters because modern distributed systems fail in ways nobody anticipated. A monolith has a finite number of failure modes. A system of multiple services calling each other, each with their own deployment schedule, feature flags, database connections, and caching layers, fails in combinatorial ways that no dashboard can predict.

### 1.2 The Trace-First Mental Model

The central insight of modern observability is that **traces are the backbone**. Not logs. Not metrics. Traces.

This is a departure from how most developers learn to instrument code. The typical progression is: start with `console.log()`, graduate to structured logging, maybe add some metrics, and treat tracing as an advanced topic. This progression is backwards. Traces should be the first thing you set up, because they give you the most information with the least effort once the foundation is in place.

A trace represents the complete lifecycle of a **unit of work** — usually an inbound request, but also a background job, a scheduled task, or any discrete operation with a beginning and an end (see §2.1 for the full taxonomy). A trace is composed of spans, where each span represents a sub-unit of work: a database query, an HTTP call to another service, a cache lookup, a significant computation. Spans have parent-child relationships that form a tree, and the tree shows you exactly how work was structured, what called what, and where time was spent.

The root span of a trace — the outermost span that represents the entire unit of work — is the single most important telemetry artifact your application produces. It is your **canonical event**: the authoritative record of what happened to this request, who it was for, what the outcome was, and every piece of context that might matter for debugging.

This concept has been called many things: Stripe called it the "canonical log line" (2016). Charity Majors calls it the "wide event." Meta's internal system Scuba operates on the same principle. The names differ, but the idea is identical: for each unit of work, emit one rich, structured record containing every dimension you might want to query, filter, or group by.

In this constitution, the root span IS the canonical log line. Its attributes ARE the wide event fields. You get the wide event pattern with the structural superpowers of tracing — duration decomposition, parent-child hierarchy, and cross-service correlation — built in.

### 1.3 Why Not Logs First?

Traditional logging is optimized for writing, not for querying. A developer writes `log.info("Processing payment for user {}", userId)` because it's easy in the moment. Nobody thinks about the engineer who will be searching for this at 3am during an outage.

The problems with a log-first approach:

**Scattered context.** Information about a single request is spread across dozens of log lines emitted at different points during execution. To reconstruct what happened, you must find all related lines (usually by grepping for a request ID), mentally reassemble them in order, and hope nothing is missing.

**No duration or structure.** A log line is a point-in-time event. It can record "this request completed in 850ms" but it cannot decompose where that time went. You'd have to manually instrument sub-durations as separate log fields, and even then you can't see parallelism or nesting.

**No cross-service correlation.** When Service A calls Service B which calls Service C, each service emits its own log lines. Without distributed trace context, these are three unrelated streams of text. You correlate by timestamp and hope.

**Noise.** A typical request generates 10-20 log lines. At 10,000 requests per second, that's 100,000-200,000 log lines per second. Most of them say nothing useful. The signal-to-noise ratio is terrible.

With traces, you get structure, duration, hierarchy, and cross-service correlation automatically. The root span carries all the context a canonical log line would carry, plus it's connected to child spans that show you the internal breakdown. The only thing you lose is the narrative stream of "what the code is doing step by step" — and that narrative is precisely the thing that doesn't scale.

### 1.4 The Signals and Their Roles

Observability uses multiple signal types. Each has a distinct role, and using the wrong signal for the wrong purpose wastes money and produces poor results.

**Traces (the backbone):** For understanding what happened to a specific request or unit of work. Traces give you the lifecycle, the timing, the structure, the context, and the cross-service flow. They are the primary artifact for debugging, investigation, and understanding system behavior. The root span, enriched with business context, is your canonical event — the single most queryable, useful piece of telemetry you produce.

**Logs (supplementary detail):** For recording information that doesn't belong on a span — things that happen outside a request context (service startup, shutdown, configuration changes), audit records that need independent retention, large diagnostic payloads that would bloat spans, and output from third-party systems that only produce logs. When logs DO relate to a request, they MUST carry the trace ID for correlation.

**Metrics (infrastructure and alerting):** For continuous time-series signals that need to be cheap, fast, and long-retained. Infrastructure health (CPU, memory, disk, network), SLO tracking, alerting thresholds, and aggregated business KPIs that need months or years of retention. Metrics are the right tool when you need to answer "what is the current value of X?" or "what is the trend of X over the last 90 days?" at minimal cost.

The critical insight: for request-scoped application telemetry, traces subsume the role that logs traditionally played. You should almost never emit a traditional log line from request-handling code. If you find yourself wanting to log something during a request, ask whether it should be a span attribute, a child span, or a span event instead.

### 1.5 Adjacent Signals Not Covered Here

The following are relevant to a complete observability practice but are outside the scope of this constitution, which focuses on application-level instrumentation:

**Continuous Profiling.** OpenTelemetry adopted profiling as a signal type in 2026. CPU profiles, memory allocation profiles, and wall-clock profiles connected to trace IDs let you go from "this span was slow" to "here's the hot function." Profiling is enabled at the infrastructure level (via tools like Pyroscope or eBPF-based profilers), not through application instrumentation patterns. It doesn't change how you write spans or attributes, but it's a powerful complement to trace-based investigation.

**Frontend / Real User Monitoring (RUM).** This constitution covers server-side instrumentation. Frontend observability (Core Web Vitals, JS errors, session replay) is a separate discipline. However, OTel's browser JS SDK can propagate trace context from frontend `fetch()` calls to backend services via the `traceparent` header, creating traces that span from browser to backend. If your application has a frontend, consider connecting it to your trace pipeline for end-to-end visibility.

**eBPF / Zero-Instrumentation Observability.** Tools like Grafana Beyla and Cilium can generate basic HTTP traces and metrics from kernel-level observation with zero code changes. This provides baseline coverage for services that haven't been instrumented yet. However, eBPF instrumentation cannot add business context — user IDs, feature flags, customer tiers — because it operates at the network layer, not the application layer. It's a useful safety net, not a replacement for application-level instrumentation.

**SLO Framework Design.** SLOs (Service Level Objectives) are the primary mechanism for translating observability data into engineering decisions — should we ship features or fix reliability? SLIs (Service Level Indicators) can be derived directly from canonical span attributes: "percentage of requests where `http.response.status_code < 500` and `duration < 500ms`." Your canonical span schema should be designed with SLO derivation in mind. Full SLO framework design is a downstream operational concern not covered here.

---

## Part 2: The Anatomy of a Trace

### 2.1 Units of Work — What Gets a Root Span

A **unit of work** is any discrete, bounded operation that your system performs — something with a clear beginning, a clear end, and a meaningful outcome. Every unit of work gets its own trace with its own root span.

The test: Can you meaningfully say "this operation succeeded or failed, took X milliseconds, and was initiated by Y"? If yes, it's a unit of work and gets a root span.

**What qualifies as a unit of work:**

| Type | Description | Root Span Starts | Root Span Ends |
|---|---|---|---|
| **Inbound HTTP request** | The most common unit of work. A client sends a request, your service processes it, and returns a response. | When the request arrives | When the response is sent |
| **Background job** | A job is pulled from a queue (Redis, SQS, RabbitMQ, database job table) and processed. | When the job begins processing | When processing completes or fails |
| **Scheduled task / cron** | A timer fires or cron schedule triggers work. Each execution is its own unit of work. | When the execution starts | When the execution completes |
| **Message consumption** | A message arrives on a Kafka topic, SQS queue, or similar. Processing that message is a unit of work. | When processing begins | When processing completes |
| **WebSocket message** | Each discrete message received on a WebSocket connection (the connection itself is long-lived infrastructure, not a unit of work). | When the message is received | When the response/ack is sent |
| **GraphQL operation** | Each query or mutation. For batched requests, each operation in the batch is its own unit of work. | When the operation begins | When the result is returned |
| **gRPC call** | Each unary RPC call. For server-streaming, the entire stream is one unit of work. | When the call is received | When the response/stream completes |
| **CLI command** | Each invocation of a CLI tool or script. | When execution starts | When execution completes |

**What is NOT a unit of work:**

- A function call within a request — that's internal, potentially a child span
- A database query — that's a sub-operation, automatically a child span via auto-instrumentation
- A long-lived process like "the server is running" — that's infrastructure, not a unit of work
- A WebSocket or database connection being established — that's a lifecycle event, handled by logs
- A loop iteration — that's internal computation
- A retry attempt — that's part of the parent operation, recorded as a span event

### 2.2 Trace, Span, Root Span

A **trace** is identified by a trace ID — a 128-bit (32 hex character) identifier that remains constant across every service involved in processing a single unit of work. Every span within a trace shares this trace ID.

A **span** is a named, timed operation within a trace. It has:
- A **span ID** (unique to this span)
- A **parent span ID** (pointing to the span that initiated this work; empty for the root)
- A **start time** and **end time** (giving you duration)
- A **name** (describing the operation, e.g., `POST /checkout` or `db.query`)
- A **span kind** (CLIENT, SERVER, INTERNAL, PRODUCER, CONSUMER)
- A **status** (OK, ERROR, UNSET)
- **Attributes** (key-value pairs carrying context)
- **Events** (timestamped annotations that occurred during the span)
- **Links** (references to other traces/spans for causal but non-parent relationships)

The **root span** is the outermost span in a trace — the one with no parent. For a web service, this is typically the span representing the full HTTP request/response lifecycle. The root span is where your canonical event attributes live.

### 2.3 How Context Propagates Across Services

When Service A makes an HTTP call to Service B, the OpenTelemetry SDK automatically injects a `traceparent` HTTP header:

```
traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
```

This header contains:
- Version: `00`
- Trace ID: `4bf92f3577b34da6a3ce929d0e0e4736` (same across the entire distributed trace)
- Parent Span ID: `00f067aa0ba902b7` (the specific span in Service A that made the call)
- Trace Flags: `01` (sampled)

This follows the **W3C Trace Context** standard — the stable, ratified specification that all OpenTelemetry implementations use. When Service B receives the request, its OTel SDK reads the `traceparent` header, extracts the trace ID and parent span ID, and creates a new root span for Service B that is a child of the calling span in Service A. The tree is built automatically.

This propagation is completely automatic with OTel auto-instrumentation. You do not write code to propagate context. The HTTP client instrumentation injects headers on outbound calls, and the HTTP server instrumentation extracts them on inbound calls. This also works for gRPC, messaging systems, and other supported protocols.

### 2.4 Baggage — Propagating Business Context Across Services

OTel provides a mechanism called **Baggage** for propagating key-value pairs across service boundaries via a `baggage` HTTP header.

**Use baggage sparingly.** Baggage is transmitted in plaintext HTTP headers to every downstream service, including external third-party APIs. Never put PII or sensitive data in baggage. Appropriate uses include deployment IDs, feature flag contexts, or request-scoping identifiers that all services need.

The recommended approach for business context: **each service populates its own span attributes** based on the context available to it (auth tokens, database lookups, configuration). The canonical span schema defines what SHOULD be present, and each service is responsible for populating what it can.

### 2.5 Span Events — The Bridge Between Spans and Logs

Span events are timestamped records that occur during a span's lifetime. They have a name and their own set of attributes. The most important use case is recording exceptions:

```
Span: POST /checkout (850ms, status=ERROR)
  Attributes:
    http.request.method = POST
    http.route = /checkout
    http.response.status_code = 500
    app.user.id = usr_123
    app.customer.tier = enterprise

  Events:
    - timestamp: 2026-03-27T14:30:02.445Z
      name: exception
      attributes:
        exception.type = PaymentProviderTimeout
        exception.message = "Connection timed out after 30s"
        exception.stacktrace = "at PaymentClient.charge()..."
```

The stack trace lives on the span as an event — not a separate log record in a separate system, and not a span attribute (stack traces aren't something you'd GROUP BY). When you view this trace in your backend, you see the span, its attributes, and the exception event with the full stack trace, all in one place.

**Use span events for:**
- Exceptions and errors (use `span.recordException()`)
- Notable state transitions within a span (e.g., "cache miss, falling back to database")
- Retry attempts (e.g., "retry attempt 2 of 3, backoff 200ms")

**Do not use span events for:**
- High-frequency occurrences within a span (e.g., each iteration of a loop — this bloats the span)
- Large payloads (e.g., full HTTP response bodies — use log records if captured at all)

**Practical limitation:** Most trace backends don't provide an independent query surface for span events. You can't easily say "show me all exception events across all traces in the last hour." For error-class events where you need aggregate querying, consider also emitting a correlated OTel log record (carrying the trace ID) alongside the span event. This gives you the event on the span for trace-level investigation AND a queryable log record for aggregate analysis.

### 2.6 Child Spans — When and Why

Child spans decompose the work within a unit of work. Auto-instrumentation creates child spans automatically for HTTP client calls, database queries, gRPC calls, and messaging operations. You get these for free.

**When to create manual child spans:**
- When an operation crosses a significant boundary (calling an external API not covered by auto-instrumentation)
- When you need to measure the duration of a distinct, significant sub-operation (a complex computation, a file processing step, a batch operation)
- When the operation has its own meaningful attributes that differ from the parent

**When NOT to create child spans:**
- For every function call (this creates thousands of worthless spans)
- For trivially fast operations (a span for a 1ms in-memory lookup adds overhead without value)
- For operations whose duration you can capture as an attribute on the parent span

The rule of thumb: create a span when you'd want to see it as a distinct block in a trace waterfall visualization, with its own timing bar.

### 2.7 Span Links — Connecting Separate Units of Work

Span links express causal relationships between separate traces. Unlike parent-child relationships (which imply synchronous nesting within one trace), span links say "this work was caused by that work" without implying they share a lifecycle.

**Use span links for:**
- Message consumers linking back to the producer trace
- Saga steps linking to the previous step
- Dead-letter queue processing linking to the original failed trace
- Fan-out operations where a single request spawns multiple independent work units

---

## Part 3: The Canonical Root Span — Your Wide Event

### 3.1 What Goes on the Root Span

The root span is where your canonical event attributes live. This is the single most important design decision in your observability setup: what attributes does every root span carry?

The goal is to make every root span independently queryable for any dimension that might matter during an investigation. You should be able to write queries like:

- "Show me all requests from enterprise customers that returned 500 errors in the last hour"
- "Compare p99 latency between the current deploy and the previous deploy"
- "Show me all requests that hit the new checkout flow feature flag and were slower than 2 seconds"
- "Which team's services have the highest error rate right now?"

Each of these queries requires specific attributes to exist on the root span. If the attribute isn't there, the query is impossible.

### 3.2 Required Attribute Categories

The canonical root span MUST include attributes from the following categories. Specific attribute names are defined in the Codebase Spec (Tier 2), but the categories are universal.

#### Service Identity

Who produced this span? Which service, which version, which environment, which team, which instance?

Standard OTel resource attributes cover the basics:
- `service.name` — the name of the service
- `service.version` — the deployed version or build SHA
- `deployment.environment.name` — production, staging, development

Additional service context:
- The team that owns the service
- The communication channel for the owning team (Slack channel, email alias)
- The instance or container identifier
- The cloud region or availability zone

#### Request Identity

What was this request? What endpoint, what method, what protocol?

OTel semantic conventions provide stable attribute names:
- `http.request.method` — GET, POST, PUT, DELETE
- `http.route` — the route template (e.g., `/api/v1/users/:id`, not the specific URL)
- `url.path` — the actual path
- `http.response.status_code` — the response code
- A unique request ID

#### User and Authentication Context

Who made this request? How were they authenticated? What permissions do they have?

This is business-specific and lives in the `app.*` namespace:
- User identifier (e.g., `app.user.id`)
- Authentication method (e.g., `app.auth.method` — api_key, oauth, session)
- User tier or subscription level (e.g., `app.customer.tier`)
- Organization or tenant identifier for multi-tenant systems

#### Business Context

What is the business significance of this request?

- Feature flags active for this request
- Business transaction type (e.g., checkout, refund, subscription_renewal)
- Business-relevant values (e.g., cart value, order item count)
- Experiment or A/B test bucket

#### Deployment Context

What version of the code is running? What changed recently?

- Build or commit SHA
- Deploy identifier
- Deploy timestamp
- CI/CD pipeline run identifier

#### Performance Breakdown

Summary attributes on the root span for fast aggregate queries without traversing the span tree:
- Total database time
- Number of database queries
- External HTTP call time
- Cache hit or miss

#### Outcome and Error Context

- The span's built-in status (OK or ERROR)
- Error type or class (`error.type` — OTel semantic convention)
- Whether the error is retriable
- Specific error codes from external systems

### 3.3 Attribute Naming Conventions

**Use OTel semantic conventions for standard attributes.** These are the stable, community-agreed names for common concepts.

Stable OTel semantic convention attributes:
- `http.request.method`, `http.response.status_code`, `http.route`
- `db.system`, `db.namespace`, `db.operation.name`
- `server.address`, `server.port`
- `error.type`
- `service.name`, `service.version`

**Use the `app.*` namespace for all business-specific attributes:**

```
app.user.*          — User identity and profile context
app.customer.*      — Customer/account-level context (tier, plan, org)
app.tenant.*        — Multi-tenancy context
app.auth.*          — Authentication and authorization details
app.deploy.*        — Deployment and release context
app.flag.*          — Feature flag states
app.experiment.*    — A/B test and experiment context
app.transaction.*   — Business transaction context
app.error.*         — Application-specific error details
app.cache.*         — Caching behavior
app.db.*            — Database summary stats on root span
app.external.*      — External service call summaries
app.job.*           — Background job context
app.queue.*         — Message queue context
app.saga.*          — Multi-step workflow context
app.schema.version  — The schema version this span conforms to
```

**Naming rules:**
- Use `snake_case` for attribute names
- Use dot-separated namespaces (e.g., `app.user.id`, not `app_user_id`)
- Use consistent types — don't store the same concept as a string in one place and an integer in another
- Use enums or constrained values where possible
- Never dynamically generate attribute keys (see §3.5 Cardinality Management)

### 3.4 Attribute Value Constraints

The OTel SDK defaults to a maximum of 128 attributes per span. This is configurable and should be increased if your canonical span schema exceeds it. 200-300 attributes on a well-instrumented root span is reasonable.

Individual attribute values should be kept short and structured — IDs, enums, numbers, booleans, and short strings. The default maximum per attribute value is 2,048 bytes, which is more than sufficient for well-designed attributes.

**Do NOT store these as span attributes:**
- Full stack traces (use span events)
- Full HTTP request or response bodies (use log records if needed)
- Full SQL queries (use sanitized/parameterized versions, or omit)
- Large JSON payloads (use log records linked via trace ID)

### 3.5 Cardinality Management

Cardinality — the number of unique values an attribute can take — is the primary cost and performance driver in observability systems.

**Where high cardinality is safe:**

In columnar trace stores, high-cardinality values in span attributes are fine: user IDs, request IDs, trace IDs, deploy SHAs. These are individual values on individual spans, and columnar storage handles them efficiently. The wide event model depends on high-cardinality attributes being queryable — that's the whole point.

**Where high cardinality is dangerous:**

- **Span names:** Must be low-cardinality (fewer than 100 unique values per service). Use route templates (`POST /users/:id`), never interpolated paths (`POST /users/usr_123`). High-cardinality span names break backend indexing.
- **Metric labels:** Low cardinality only (fewer than 20 unique values per label dimension). Putting user IDs in metric labels creates millions of time series and crashes Prometheus.
- **Resource attributes:** Should be low-cardinality (service name, version, environment). These define the grouping dimensions for all spans from a process.

**The dynamic attribute key anti-pattern:**

Never generate attribute names from data. `app.feature.${featureName} = true` creates unbounded attribute keys, which is catastrophic for storage backends. Instead, use a single attribute with a delimited value (`app.feature_flags = "checkout_v2,fraud_ml,dark_mode"`) or use individual flags with known, enumerated names (`app.flag.checkout_v2 = true`).

**Detection:** Monitor your trace backend for unexpected storage growth or query slowdowns. Periodically audit your highest-cardinality attributes. If an attribute has more unique values than you expected, investigate whether it's unbounded.

---

## Part 4: PII, Security, and Data Sensitivity

### 4.1 Attribute Sensitivity Classification

Every attribute in your canonical schema must be classified by sensitivity:

**Public:** No restrictions. Service name, HTTP method, status code, route template, duration, span status. These contain no user-identifiable or business-sensitive information.

**Internal:** Safe for telemetry storage but should not be propagated to external services via baggage or headers. User ID, tenant ID, deploy SHA, internal error codes. These identify internal entities but aren't directly PII.

**Sensitive:** Requires explicit consideration before inclusion. Email addresses, IP addresses, user agent strings, geographic location. If included, consider whether pseudonymization (hashing) is appropriate. Include only when the debugging value justifies the privacy cost.

**Prohibited:** Must never appear in telemetry under any circumstances. Passwords, authentication tokens, credit card numbers, API keys, session secrets, social security numbers, health records.

### 4.2 Implementation Through Typed Schema

When your canonical schema is implemented as a typed interface (see §6.1), the sensitivity classification is a property of each attribute in the type definition. This makes the classification visible to both developers and coding agents at the point where attributes are set.

The typed interface should enforce that prohibited attributes cannot be set — they simply don't exist in the type. Sensitive attributes should be clearly marked in the type definition with documentation explaining the privacy implications.

### 4.3 PII Rules

- **Never store raw PII as span attributes unless explicitly justified and documented.** If you need user email for debugging, consider storing a hashed version that's consistent enough for correlation but not reversible.
- **Never put PII in baggage.** Baggage propagates to every downstream service in plaintext headers, including external third-party APIs.
- **Never capture Authorization headers, cookies, or session tokens** as span attributes. OTel auto-instrumentation may capture HTTP headers — configure it to exclude sensitive headers.
- **Be cautious with HTTP request/response body capture.** Bodies frequently contain PII. If captured at all, they should go to log records (not span attributes) with redaction applied.
- **Consider GDPR and right-to-erasure implications.** If your trace store contains user identifiers and a user requests deletion, you need a strategy: pseudonymization at ingest (recommended), short retention periods, or accepting the operational complexity of trace deletion.

---

## Part 5: When to Use Each Signal

### 5.1 The Decision Framework

When you have information to record, ask these questions in order:

**1. Is this happening during a unit of work that has a trace?**

- YES → It belongs on the trace (as a span attribute, child span, or span event). Continue to question 2.
- NO → It's a log record. Examples: service startup, shutdown, configuration loaded, scheduled maintenance events.

**2. Is this a dimension you'd want to query, filter, or GROUP BY?**

- YES → It's a **span attribute** on the root span (or the relevant child span). Examples: user ID, customer tier, feature flags, error codes, response status, deploy SHA.
- NO → Continue to question 3.

**3. Is this a distinct operation with meaningful duration?**

- YES → It's a **child span**. Examples: a database query, an HTTP call to another service, a significant computation.
- NO → Continue to question 4.

**4. Is this a notable point-in-time occurrence during the span?**

- YES → It's a **span event**. Examples: an exception, a retry attempt, a cache miss, a state transition.
- NO → You probably don't need to record it.

**5. Is this something that needs aggregate querying independent of traces?**

- YES → Consider also emitting a **log record** (correlated via trace ID) or a **metric**.

**6. Is this a continuous numerical measurement over time?**

- YES → It's a **metric**. Examples: CPU utilization, memory usage, queue depth, connection pool size.

### 5.2 What Traditional Log Lines Become

| Traditional Log Pattern | Trace-First Equivalent |
|---|---|
| `log.info("Request received", {method, path, userId})` | Span attributes on root span (automatic via OTel + middleware) |
| `log.info("Payment processed", {chargeId, amount})` | Span attributes: `app.payment.charge_id`, `app.payment.amount_cents` |
| `log.warn("Slow database query", {duration, query})` | Child span with duration (automatic via OTel DB instrumentation) |
| `log.error("Payment failed", {error, stack})` | Span status = ERROR + span event with `exception.type`, `exception.message`, `exception.stacktrace` |
| `log.debug("Cache miss, falling back")` | Span attribute `app.cache.hit = false` or span event "cache_miss" |
| `log.info("Retrying request", {attempt, backoff})` | Span event "retry" with attributes `retry.attempt`, `retry.backoff_ms` |
| `log.info("Request completed", {status, duration})` | Automatic — root span's end time, status code attribute, span status |
| `log.info("Server started on port 3000")` | **Stays as a log record** — no request context |
| `log.info("Config loaded from config.yaml")` | **Stays as a log record** — lifecycle event |
| `log.info("Scheduled cleanup job finished")` | **Root span for the job** — background jobs get their own traces |

### 5.3 When Log Records ARE the Right Tool

1. **Lifecycle events** — Service startup, shutdown, configuration loading, health status changes. No request context exists.
2. **Audit records** — Security-sensitive events that must exist independently of trace sampling.
3. **Third-party system output** — Postgres logs, Nginx access logs, Kubernetes system logs.
4. **Long-running process progress** — Periodic updates from multi-hour jobs that would bloat span events.
5. **Supplementary error query surface** — If your trace backend doesn't support querying span events independently.

**Rules for log records:**
- ALWAYS emit structured log records (key-value pairs / JSON), never unstructured strings
- ALWAYS include the trace ID and span ID when a trace context exists
- ALWAYS include resource attributes (service name, version, environment)
- NEVER emit traditional log lines from request-handling code — use span attributes and events instead

### 5.4 When Metrics ARE the Right Tool

1. **Infrastructure monitoring** — CPU, memory, disk, network, container stats, Kubernetes pod health. From infrastructure agents, not application code.
2. **Alerting and SLOs** — Error budgets, latency SLO burn rates, availability. Need continuous evaluation with minimal query latency.
3. **Long-retention aggregates** — Month-over-month trends, capacity planning. Cheap to store for years.
4. **Signals without request context** — Queue depth, connection pool size, thread count, active connections.

**Important:** Many application-level metrics can be derived from trace data rather than separately instrumented. Many trace backends can automatically produce RED metrics (Rate, Error, Duration) from span attributes. Before creating a new application metric, ask: "Can I derive this from my existing span data?"

---

## Part 6: Implementation Patterns

### 6.1 Schema Enforcement Through Typed Interfaces

The canonical span schema MUST be implemented as a typed interface in your application language. This is the single most important implementation decision: the type system enforces the schema at compile time.

Define a typed object or enum that IS your canonical schema. Every attribute name, its type, its allowed values — all expressed as language-level types. The middleware that builds your canonical root span accepts ONLY these typed attributes.

This gives you:

- **Compile-time enforcement.** Setting an attribute that doesn't exist in the type fails at compile time.
- **Single source of truth.** The type definition IS the schema. Agents inspect it. Developers read it. Tests import it.
- **Self-documenting.** Each field carries a type, a name, and a doc comment.
- **Built-in linting.** The language's type system IS the linter.
- **Agent-friendly.** A coding agent reads the type definition, sees what attributes exist, and uses them correctly.

**Conceptual example (TypeScript-like pseudocode):**

```
// telemetry-schema.ts — THE canonical schema. Single source of truth.
// Schema version is incremented when attributes are added or renamed.
export const SCHEMA_VERSION = "1.0.0"

export interface CanonicalSpanAttributes {
  // --- Service Identity (set by middleware) ---
  "service.name": string
  "service.version": string
  "deployment.environment.name": Environment
  "app.deploy.sha": string
  "app.deploy.id": string
  "app.service.team": string

  // --- Request Identity (set by middleware) ---
  "http.request.method": HttpMethod
  "http.route": string
  "http.response.status_code": number
  "app.request.id": string

  // --- User Context (set after auth) --- [sensitivity: internal]
  "app.user.id"?: string
  "app.auth.method"?: AuthMethod
  "app.customer.tier"?: CustomerTier

  // --- Business Context (set by handlers) ---
  "app.feature_flags"?: string
  "app.transaction.type"?: TransactionType

  // --- Performance Summary (set by middleware in finally block) ---
  "app.db.total_duration_ms"?: number
  "app.db.query_count"?: number
  "app.cache.hit"?: boolean

  // --- Outcome (set by middleware/error handler) ---
  "app.error.retriable"?: boolean
  "app.error.code"?: string

  // --- Schema ---
  "app.schema.version": string
}

export type Environment = "production" | "staging" | "development"
export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH"
export type AuthMethod = "api_key" | "oauth" | "session" | "anonymous"
export type CustomerTier = "free" | "pro" | "enterprise"
export type TransactionType = "checkout" | "refund" | "subscription_renewal"
```

When a developer or agent needs to add a new attribute, they add it to this type definition first — which is a reviewable, visible change. Then they use it. The type definition prevents drift.

**Schema versioning:** The `app.schema.version` attribute is set on every root span. When the schema changes (new attribute added, attribute renamed), the version is incremented. This allows you to query "show me spans still on schema v1.0.0" to track migration progress.

### 6.2 The Middleware Pattern for the Canonical Root Span

The canonical root span is built through a middleware that wraps every unit of work. The middleware:

1. Accesses the root span created by OTel's auto-instrumentation (or creates one for non-HTTP work)
2. Stores a reference to it so downstream handlers can add attributes
3. Enriches it with attributes available at the middleware level (request metadata, deployment context)
4. Sets the schema version
5. Ensures canonical attributes are emitted even if an error occurs (using a `finally` block)

Downstream handlers enrich the root span with business context:
- After authentication: add user ID, customer tier, auth method
- After loading business data: add cart value, subscription type, organization ID
- After feature flag evaluation: add active feature flags
- After completion: add outcome-specific attributes

### 6.3 Auto-Instrumentation Configuration

OTel auto-instrumentation creates spans for inbound HTTP requests, outbound HTTP calls, database queries, gRPC calls, messaging, and Redis operations.

**Configuration decisions:**
- **HTTP headers:** Capture User-Agent. Never capture Authorization, Cookie, or Set-Cookie headers.
- **Database queries:** Decide whether to capture query text. Even sanitized queries can be large. Consider capturing only in non-production or using truncated versions.
- **HTTP request/response bodies:** Do NOT capture as span attributes. They are large, often contain PII, and bloat spans.

### 6.4 Async, Event-Driven, and Long-Running Patterns

#### Message Consumers (Kafka, SQS, RabbitMQ)

Each consumed message creates its own trace. Use a **span link** (not a parent-child relationship) to connect the consumer trace to the producer trace. Parent-child implies synchronous nesting; span links express "this work was caused by that work" across separate lifecycles.

Set attributes for: topic/queue name, partition, offset, consumer group, processing outcome.

#### Fan-Out / Fan-In

When one request triggers N parallel operations: if N is small (under ~10), create child spans for each. If N is large, create a single child span with `app.batch.size = 100` and `app.batch.failures = 2`. Don't create hundreds of child spans — it bloats the trace.

#### Sagas and Multi-Step Workflows

A saga spanning multiple services over hours or days should NOT be one trace. Each step is its own trace, linked to the previous step via span links and a shared workflow identifier:
- `app.saga.id` — unique identifier for the entire saga
- `app.saga.step` — which step this is (1, 2, 3...)
- `app.saga.step_name` — human-readable step name
- `app.saga.total_steps` — expected total steps (if known)

Query the full saga by filtering on `app.saga.id` across traces.

#### Dead-Letter Queues

When a message fails and goes to a DLQ, the DLQ consumer creates a new trace with a span link to the original trace. Set attributes:
- `app.dlq.reason` — why it was dead-lettered
- `app.dlq.original_trace_id` — the trace ID of the original failed attempt
- `app.dlq.retry_count` — how many times this has been retried

#### Long-Running Jobs

A job running for hours should NOT be a single enormous span. Create a root span for the job with start time, type, and input parameters. Within it, create child spans for batches or checkpoints. Emit correlated log records for periodic progress updates if the volume would bloat span events.

---

## Part 7: Sampling Strategy

### 7.1 Why Sampling Exists

At high traffic volumes, storing every trace is expensive. Sampling reduces volume while preserving the traces that matter. Sampling is a cost management strategy, not a philosophical compromise.

### 7.2 SDK-Level Tail Sampling (Default Approach)

The recommended approach is to implement sampling logic in a custom SpanProcessor within your application. This runs after each span ends but before export, so it has access to the span's full attributes, status, and duration.

The decision function:

```
function shouldExport(span):
  // Always keep errors
  if span.status == ERROR: return true

  // Always keep slow requests above SLO threshold
  if span.duration > LATENCY_THRESHOLD: return true

  // Always keep critical business operations
  if span.attributes["http.route"] in CRITICAL_ROUTES: return true

  // Always keep high-tier customer requests (if available)
  if span.attributes["app.customer.tier"] == "enterprise": return true

  // Always keep requests with active rollout flags
  if span.attributes["app.feature_flags"] contains ROLLOUT_FLAGS: return true

  // Always keep requests flagged for debugging
  if span.attributes["app.debug"] == true: return true

  // Sample everything else at configured rate
  return hash(span.traceId) % 100 < SAMPLE_PERCENTAGE
```

This gives you outcome-aware sampling with no external infrastructure. The OTel SDK's BatchSpanProcessor handles batching and retry for the spans you keep.

**Limitation:** SDK-level tail sampling operates per-service. It cannot coordinate sampling decisions across services. If a request fails in Service C but succeeded in Service A and B, Service A's sampler may drop its spans (they look normal) while Service C keeps its error spans. This results in a partial trace — you can see where the error occurred but not the full upstream path.

For most applications, this is an acceptable tradeoff. The error spans in Service C carry enough context (the canonical attributes) to diagnose the issue. The full cross-service waterfall is nice to have but rarely essential for root-cause identification.

### 7.3 Cross-Service Tail Sampling (When Needed)

If you reach a scale where partial traces are a real problem — many services, complex call chains, frequent need to trace the full upstream path of failures — you introduce a centralized component.

In the Grafana ecosystem, this is **Grafana Alloy** (Grafana's distribution of the OTel Collector). In the upstream OTel ecosystem, it's the OTel Collector with the tail sampling processor.

The architecture: all services export spans to the central component instead of directly to the trace backend. The component buffers spans, groups them by trace ID, waits for the trace to complete, then applies sampling rules to the complete trace. If any span in the trace has an error, all spans for that trace are kept.

This is additional infrastructure to run and maintain. Introduce it only when the value of complete cross-service traces justifies the operational cost.

### 7.4 Sampling Gotchas

- When you sample, your trace backend should account for the sample rate when computing aggregates.
- Sampling mistakes are silent and dangerous. One misconfigured sampling rule can drop entire classes of traces without anyone noticing.
- Sampled traces are useless for forensic investigation of a specific request. For forensic/compliance use cases, consider keeping unsampled log records alongside sampled traces.
- Use deterministic sampling based on trace ID hash, so that if you sample at 10%, the same trace ID consistently gets kept or dropped across services.

---

## Part 8: Testing Observability

### 8.1 Integration Tests for Span Attributes

When you write an integration test for an endpoint, also assert that the resulting trace contains the expected root span with the expected attributes.

The pattern: your test makes a request, then queries the OTel SDK's in-memory span exporter (available in all OTel SDKs for testing) and asserts:
- The root span exists with the expected name
- Required canonical attributes are present and have correct types
- The span status matches the expected outcome
- Expected child spans exist for known sub-operations

This catches "developer refactored the handler and dropped `app.user.id`" before it reaches production.

### 8.2 Schema Conformance Tests

A test that imports the typed schema interface and verifies that for every required (non-optional) attribute, there exists code that sets it. This can be a combination of:
- Static analysis checking that the middleware sets all required fields
- Integration tests asserting the fields are present on emitted spans
- Runtime validation in the middleware's `finally` block that warns (in development) if required attributes are missing

### 8.3 Regression Detection

When a refactor changes a handler, the integration test catches if a required span attribute was dropped. When a new endpoint is added, the type system catches if the handler tries to set an attribute that doesn't exist in the schema. Together, these prevent the slow erosion of telemetry quality.

If using CI, include a step that runs the span assertion tests and fails the build if required attributes are missing. Treat telemetry regressions with the same severity as test failures.

---

## Part 9: Telemetry Pipeline Architecture

### 9.1 Direct Export (Starting Architecture)

The simplest architecture: your application's OTel SDK exports OTLP directly to your trace, log, and metric backends. The SDK handles batching, compression, and retry natively.

```
[Application + OTel SDK] --OTLP--> [Trace Backend]
                         --OTLP--> [Log Backend]
                         --OTLP--> [Metrics Backend]
```

This is appropriate for solo developers, small teams, and single-service or small-service architectures. There is no additional infrastructure to maintain. SDK-level tail sampling provides outcome-aware sampling within each service.

### 9.2 When to Introduce a Collector

Introduce a Collector (OTel Collector or Grafana Alloy) when you need:

- **Cross-service tail sampling** — The Collector sees spans from all services and can make coordinated sampling decisions (see §7.3).
- **Unified infrastructure telemetry** — A single agent that also scrapes Prometheus metrics, collects host metrics, and gathers logs from the same host. This is a convenience, not a necessity.
- **Pipeline-level processing** — Attribute enrichment, PII redaction, or routing to multiple backends that you don't want to implement in application code.
- **Operational decoupling** — Changing backend endpoints without modifying application configuration.

If none of these apply, direct export is correct. The Collector is an optimization you add when the need arises, not a prerequisite.

---

## Part 10: Naming Conventions and Standards Reference

### 10.1 Stable OTel Semantic Conventions

The following are stable and safe to build on:

**HTTP:** `http.request.method`, `http.response.status_code`, `http.route`, `url.scheme`, `url.path`, `server.address`, `server.port`, `user_agent.original`

**Database:** `db.system`, `db.namespace`, `db.operation.name`, `db.query.text` (opt-in)

**Resource:** `service.name`, `service.version`, `service.namespace`, `deployment.environment.name`, `telemetry.sdk.name`, `telemetry.sdk.language`, `telemetry.sdk.version`

**RPC:** `rpc.system`, `rpc.service`, `rpc.method`

**Network:** `network.protocol.name`, `network.protocol.version`, `network.transport`

### 10.2 Experimental OTel Conventions

**GenAI (experimental):** `gen_ai.operation.name`, `gen_ai.request.model`, `gen_ai.provider.name`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`

These are experimental — use them but document that they may change.

---

## Part 11: Anti-Patterns

### 11.1 Instrumentation Anti-Patterns

**❌ Console.log / printf debugging in production code.** Traditional log lines in request handlers fragment context and lack structure. Use span attributes and events.

**❌ Logging the same information that span attributes carry.** If user ID is a span attribute, don't also emit a log line for it. The span attribute is the canonical record.

**❌ Creating a span for every function call.** This produces thousands of short, meaningless spans. Create spans for operations with meaningful duration that cross a boundary.

**❌ Storing large payloads as span attributes.** Stack traces go in span events. HTTP bodies go in log records. SQL queries go in sanitized/truncated form or are omitted.

**❌ Using high-cardinality values in span NAMES.** Span names must be low-cardinality templates: `POST /users/:id`, not `POST /users/usr_123`.

**❌ Inconsistent attribute naming across services.** If Service A uses `userId` and Service B uses `user_id` and Service C uses `app.user.id`, cross-service queries are impossible. The typed schema is the single source of truth.

**❌ Omitting business context from spans.** A trace with only HTTP method, status code, and duration is nearly useless during an incident. Business context transforms traces into debugging tools.

**❌ Dynamically generating attribute keys.** `app.feature.${name} = true` creates unbounded keys. Use enumerated flag names or delimited values.

### 11.2 Sampling Anti-Patterns

**❌ No sampling strategy.** Collecting 100% of everything works at low traffic and bankrupts you at scale.

**❌ Uniform random sampling only.** You lose 90% of your errors and slow requests. Always combine probabilistic sampling with rules-based retention for high-value traces.

**❌ Trusting sampled data for forensic investigation.** A specific customer's trace may have been sampled away. Have a strategy for forensic use cases.

### 11.3 Organizational Anti-Patterns

**❌ Treating observability as an afterthought.** Instrument as you write code, not after it breaks.

**❌ Building dashboards without investigating.** Dashboards answer known questions. Observability is about unknown questions. The primary workflow is interactive querying.

**❌ Separate tools with no correlation.** If traces, logs, and metrics can't be cross-referenced, you're doing pillar-hopping — the slowest debugging experience.

---

## Part 12: Agent Integration

### 12.1 Agents Generating Instrumented Code

When an AI coding agent generates code for a project governed by this constitution, it MUST:

1. **Read the typed schema interface first.** Understand what attributes exist, what types they take, and where they are set.
2. **Never emit traditional log lines in request-handling code.** All request-scoped telemetry goes on span attributes or span events.
3. **Follow the canonical span schema.** Any new endpoint or handler must enrich the root span with the attributes defined in the typed schema.
4. **Use OTel semantic conventions for standard attributes.** HTTP, database, RPC attributes use OTel-defined names.
5. **Use the `app.*` namespace for business attributes.** New business attributes must be added to the typed schema first — a reviewable change.
6. **Create child spans only when warranted.** Operations that cross a boundary or have meaningful duration. Internal function calls do not.
7. **Record exceptions properly.** Use `span.recordException()` and set `span.setStatus(ERROR)`.
8. **Never put variable data in span names.** Low-cardinality templates only.
9. **Never store large payloads as span attributes.** Stack traces in span events. Large payloads in log records.
10. **Classify new attributes by sensitivity.** Check §4.1 before adding any attribute that could contain user data.

### 12.2 Agents Consuming Telemetry

When an AI agent queries telemetry to verify behavior or investigate issues:

1. **Query traces by span attributes.** The canonical root span is the primary query surface.
2. **Verify behavior against span data.** Check: "Are there error-status spans since the deploy? Has p99 latency changed?"
3. **Use the typed schema as the query vocabulary.** The attribute names in the schema are the query dimensions.
4. **Follow the trace tree for structural investigation.** Examine child spans to identify bottlenecks.

### 12.3 The Telemetry Feedback Loop

1. Agent generates code with proper instrumentation (following the typed schema)
2. Code is deployed (with deploy SHA and deploy ID as span attributes)
3. Agent queries telemetry to verify: "Is the new code healthy? Are there errors? Is latency within bounds?"
4. If issues are detected, the agent queries deeper using canonical span attributes
5. The agent either fixes the issue or surfaces it to a human with full context

This loop only works if the telemetry is structured, consistent, and queryable — which is what the typed schema and canonical root span provide.

---

## Part 13: The Codebase Spec (Tier 2) — Template

The Codebase Spec is the project-specific document that instantiates this constitution. It contains:

### Service Catalog
- Service name, team, communication channel
- Dependencies (databases, caches, external APIs, other services)
- Traffic characteristics

### Typed Schema File Location
- Path to the typed interface definition
- Current schema version
- Migration notes for schema changes

### Canonical Root Span Schema
The complete attribute list, imported from or mirroring the typed interface:
- Attribute name, type, description
- Source (where in the code this gets set)
- Sensitivity classification
- Required or optional

### Custom Child Span Definitions
Manual spans beyond auto-instrumentation:
- Span name, when created, attributes

### Metrics Definitions
Explicitly instrumented metrics (those that can't be derived from spans):
- Metric name, instrument type, description, unit, label dimensions
- Why this metric exists

### Sampling Configuration
- SDK-level tail sampling rules
- Critical routes and business operations list
- Sample percentage for routine traffic

### Log Record Definitions
Specific log records this service emits:
- Event name, when emitted, attributes, trace correlation

### Backend Configuration
- Export endpoints (direct or via Collector)
- Retention policies per signal type

---

## Appendix A: Glossary

| Term | Definition |
|---|---|
| **Trace** | The complete record of a unit of work, identified by a trace ID, spanning one or more services |
| **Span** | A named, timed operation within a trace, with attributes, events, and parent-child relationships |
| **Root Span** | The outermost span in a trace — no parent. Represents the full unit of work |
| **Canonical Span / Wide Event** | The root span enriched with all relevant context — the authoritative record of the request |
| **Span Event** | A timestamped annotation on a span (e.g., exception, state transition) |
| **Span Attribute** | A key-value pair on a span providing queryable context |
| **Span Link** | A reference from one span to another span in a different trace, expressing causal relationships |
| **Resource Attribute** | An attribute describing the entity producing telemetry (service name, version, environment) |
| **Baggage** | Key-value pairs propagated across service boundaries via HTTP headers |
| **W3C Trace Context** | The standard for trace context propagation via the `traceparent` header |
| **OTLP** | OpenTelemetry Protocol — the wire format for transmitting telemetry data |
| **OTel Collector** | The vendor-neutral pipeline component that receives, processes, and exports telemetry |
| **Semantic Conventions** | OTel's standardized attribute names for common concepts |
| **Unit of Work** | A discrete, bounded operation with a beginning, end, and meaningful outcome |
| **RED Metrics** | Rate, Error, Duration — the three fundamental service health metrics |
| **Head Sampling** | Sampling decision made at request start (cheap, blind to outcome) |
| **Tail Sampling** | Sampling decision made after span/trace completion (outcome-aware) |
| **Cardinality** | The number of unique values an attribute can take |
| **Dimensionality** | The number of attributes on an event |

## Appendix B: Further Reading

- **Stripe's Canonical Log Lines** — Brandur Leach (2016, 2019). The original pattern. https://brandur.org/canonical-log-lines and https://stripe.com/blog/canonical-log-lines
- **Logs vs Structured Events** — Charity Majors (2019). The philosophical case. https://charity.wtf/2019/02/05/logs-vs-structured-events/
- **A Practitioner's Guide to Wide Events** — Jeremy Morrell (2024). The practical implementation guide. https://jeremymorrell.dev/blog/a-practitioners-guide-to-wide-events/
- **All You Need is Wide Events** — Ivan Burmistrov (2024). Meta's Scuba and the wide event model. https://isburmistrov.substack.com/p/all-you-need-is-wide-events-not-metrics
- **Logging Sucks** — Boris Tane (2024). Why traditional logging fails and how wide events fix it. https://loggingsucks.com/
- **Are We Ready for Observability 2.0?** — Laban Eilers (2025). Honest assessment of tradeoffs. https://labaneilers.com/are-we-ready-for-observability-2.0
- **OpenTelemetry Semantic Conventions** — The canonical reference. https://opentelemetry.io/docs/specs/semconv/
- **OpenTelemetry Traces Concepts** — Official documentation. https://opentelemetry.io/docs/concepts/signals/traces/
- **OpenTelemetry Logs Concepts** — Official documentation. https://opentelemetry.io/docs/concepts/signals/logs/
- **OpenTelemetry Sampling** — Official documentation. https://opentelemetry.io/docs/concepts/sampling/
- **Closing the Loop: Coding Agents and Telemetry** — Arize (2026). The agentic feedback loop. https://arize.com/blog/closing-the-loop-coding-agents-telemetry-and-the-path-to-self-improving-software/
