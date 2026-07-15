CREATE TABLE IF NOT EXISTS codecrush_eval_targets (
  target_trace_id String,
  judge_version String,
  evaluated_at_state AggregateFunction(argMax, DateTime64(9), DateTime64(9)),
  agent_id_state AggregateFunction(argMax, String, DateTime64(9)),
  generation_model_state AggregateFunction(argMax, String, DateTime64(9)),
  faithfulness_state AggregateFunction(argMax, Float64, DateTime64(9)),
  answer_relevancy_state AggregateFunction(argMax, Float64, DateTime64(9)),
  context_precision_state AggregateFunction(argMax, Float64, DateTime64(9))
) ENGINE = AggregatingMergeTree
ORDER BY (judge_version, target_trace_id);

CREATE MATERIALIZED VIEW IF NOT EXISTS codecrush_eval_targets_mv
TO codecrush_eval_targets AS
SELECT
  SpanAttributes['rag.eval.target_trace_id'] AS target_trace_id,
  SpanAttributes['rag.eval.version'] AS judge_version,
  argMaxState(Timestamp, Timestamp) AS evaluated_at_state,
  argMaxState(SpanAttributes['gen_ai.agent.id'], Timestamp) AS agent_id_state,
  argMaxState(SpanAttributes['gen_ai.request.model'], Timestamp) AS generation_model_state,
  argMaxState(toFloat64OrZero(SpanAttributes['rag.eval.faithfulness']), Timestamp) AS faithfulness_state,
  argMaxState(toFloat64OrZero(SpanAttributes['rag.eval.answer_relevancy']), Timestamp) AS answer_relevancy_state,
  argMaxState(toFloat64OrZero(SpanAttributes['rag.eval.context_precision']), Timestamp) AS context_precision_state
FROM otel_traces
WHERE SpanName = 'rag.eval'
  AND SpanAttributes['rag.eval.status'] = 'success'
  AND SpanAttributes['rag.eval.target_trace_id'] != ''
  AND SpanAttributes['rag.eval.version'] != ''
GROUP BY target_trace_id, judge_version;

CREATE OR REPLACE VIEW codecrush_eval_1m AS
SELECT
  toStartOfMinute(evaluated_at) AS bucket,
  agent_id,
  judge_version,
  count() AS sample_count,
  avg(faithfulness) AS faithfulness,
  avg(answer_relevancy) AS answer_relevancy,
  avg(context_precision) AS context_precision
FROM (
  SELECT
    target_trace_id,
    judge_version,
    argMaxMerge(evaluated_at_state) AS evaluated_at,
    argMaxMerge(agent_id_state) AS agent_id,
    argMaxMerge(faithfulness_state) AS faithfulness,
    argMaxMerge(answer_relevancy_state) AS answer_relevancy,
    argMaxMerge(context_precision_state) AS context_precision
  FROM codecrush_eval_targets
  GROUP BY target_trace_id, judge_version
)
GROUP BY bucket, agent_id, judge_version;
