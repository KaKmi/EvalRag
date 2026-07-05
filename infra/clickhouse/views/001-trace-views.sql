CREATE VIEW IF NOT EXISTS codecrush_trace_spans AS
SELECT
  TraceId AS trace_id,
  SpanId AS span_id,
  nullIf(ParentSpanId, '') AS parent_span_id,
  SpanName AS name,
  if(SpanAttributes['codecrush.span.kind'] = '', toString(SpanKind), SpanAttributes['codecrush.span.kind']) AS kind,
  Timestamp AS start_time,
  toFloat64(Duration) / 1000000 AS duration_ms,
  toString(StatusCode) AS status_code,
  SpanAttributes AS attributes
FROM otel_traces;
