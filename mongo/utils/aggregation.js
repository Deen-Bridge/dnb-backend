/**
 * @module mongo/utils/aggregation
 * Reusable MongoDB aggregation-pipeline builder helpers.
 * -------------------------------------------------------------------------
 * These are pure, dependency-free helpers that a repository (for example a
 * `ReportRepository` or a metrics/analytics service) can compose to build
 * aggregation pipelines without duplicating stage-construction logic.
 *
 * Every function here **builds** plain JavaScript objects/arrays describing
 * aggregation stages or whole pipelines. Nothing in this module touches
 * express, connects to a database, or executes a query — a caller runs the
 * result with `Model.aggregate(pipeline)`. This keeps the builders trivially
 * unit-testable and reusable across models.
 *
 * Why a separate utility?
 * -----------------------
 *   - **Consistency.** Every group/sum/count/average and every date bucket in
 *     the application is constructed the same way.
 *   - **Composability.** Thin, single-purpose stage builders (`matchStage`,
 *     `sortStage`, …) can be assembled by hand or through `buildPipeline`,
 *     which orders and omits stages for you.
 *   - **Correctness.** Date bucketing is centralised so daily/weekly/monthly
 *     grouping (and timezone handling) behaves identically everywhere.
 *
 * Date-bucketing approach
 * -----------------------
 * Date buckets are built with `$dateToString` (not `$dateTrunc`). Each bucket
 * key is therefore a **string** whose lexical order matches chronological
 * order, so an ascending `$sort` on the bucket key yields a correct time
 * series. The formats used are:
 *   - `daily`   → `"%Y-%m-%d"`        e.g. `"2026-08-24"`
 *   - `weekly`  → `"%G-W%V"`          e.g. `"2026-W34"` (ISO-8601 week + year)
 *   - `monthly` → `"%Y-%m"`           e.g. `"2026-08"`
 * A `timezone` (IANA name or fixed offset, default `"UTC"`) selects the local
 * calendar used to compute the bucket.
 *
 * Conventions for anything added under `/mongo`:
 *   - Builders never call `res`/express — they return data or throw.
 *   - Every exported function/class carries complete JSDoc.
 */

/**
 * @typedef {("daily"|"weekly"|"monthly")} Granularity
 * A supported date-bucketing granularity.
 */

/**
 * @typedef {("sum"|"avg"|"min"|"max"|"count")} TimeSeriesOp
 * The aggregation operation applied to each time-series bucket.
 */

/**
 * @typedef {Object} TimeSeriesOptions
 * @property {Granularity} granularity          Bucket size: `daily`, `weekly`
 *   or `monthly`.
 * @property {string} [valueField]              The numeric field to aggregate.
 *   Required for every `op` except `"count"` (which counts documents).
 * @property {TimeSeriesOp} [op="sum"]          How to aggregate each bucket.
 * @property {string} [timezone="UTC"]          IANA timezone (or fixed offset)
 *   used to compute the calendar bucket.
 */

/** The `$dateToString` format string for each supported granularity. */
const GRANULARITY_FORMATS = Object.freeze({
  daily: "%Y-%m-%d",
  weekly: "%G-W%V",
  monthly: "%Y-%m",
});

/** Map of {@link TimeSeriesOp} → MongoDB accumulator operator. */
const OP_OPERATORS = Object.freeze({
  sum: "$sum",
  avg: "$avg",
  min: "$min",
  max: "$max",
});

/**
 * Normalise a field name into an aggregation field reference (a `"$field"`
 * path). Values that already start with `$` are returned untouched so callers
 * may pass either `"amount"` or `"$amount"`.
 *
 * @param {string} field The field name.
 * @returns {string} A field-path reference usable inside aggregation operators.
 * @throws {TypeError} If `field` is not a non-empty string.
 */
function fieldRef(field) {
  if (typeof field !== "string" || field.trim() === "") {
    throw new TypeError("field must be a non-empty string");
  }
  const trimmed = field.trim();
  return trimmed.startsWith("$") ? trimmed : `$${trimmed}`;
}

/**
 * Assert a value is a plain object (and not null / an array).
 *
 * @param {*} value The value to check.
 * @param {string} label Used in the thrown error message.
 * @returns {Object} The validated object.
 * @throws {TypeError} If `value` is not a plain object.
 */
function assertObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be a plain object`);
  }
  return value;
}

/**
 * Build a `$group` stage with an explicit set of accumulator expressions.
 *
 * Grouping is done by `field` (a single field reference) or, when `field` is
 * `null`/`undefined`, by the whole collection (`_id: null`).
 *
 * @param {?string} field                  Field to group by, or `null` for the
 *   whole collection.
 * @param {Object} accumulators            Map of output field → accumulator
 *   expression, e.g. `{ total: { $sum: "$amount" }, n: { $sum: 1 } }`.
 * @returns {Object} A `$group` stage.
 * @throws {TypeError} If `accumulators` is not a non-empty plain object, or
 *   `field` is provided but not a string.
 * @example
 * groupBy("category", { total: { $sum: "$amount" } });
 * // → { $group: { _id: "$category", total: { $sum: "$amount" } } }
 * @example
 * groupBy(null, { total: { $sum: "$amount" } });
 * // → { $group: { _id: null, total: { $sum: "$amount" } } }
 */
export function groupBy(field, accumulators) {
  assertObject(accumulators, "accumulators");
  if (Object.keys(accumulators).length === 0) {
    throw new TypeError("accumulators must have at least one entry");
  }
  const id = field === null || field === undefined ? null : fieldRef(field);
  return { $group: { _id: id, ...accumulators } };
}

/**
 * Build a `$group` stage that sums `field`, optionally grouped by `groupField`.
 *
 * @param {string} field                   The numeric field to sum.
 * @param {?string} [groupField=null]      Field to group by, or `null` for the
 *   whole-collection total.
 * @param {string} [as="total"]            Name of the output sum field.
 * @returns {Object} A `$group` stage.
 * @throws {TypeError} If `field` is not a non-empty string.
 * @example
 * sumBy("amount", "category");
 * // → { $group: { _id: "$category", total: { $sum: "$amount" } } }
 */
export function sumBy(field, groupField = null, as = "total") {
  const ref = fieldRef(field);
  return groupBy(groupField, { [as]: { $sum: ref } });
}

/**
 * Build a `$group` stage that counts how many documents fall into each distinct
 * value of `field`.
 *
 * @param {string} field                   The field whose values are counted.
 * @param {string} [as="count"]            Name of the output count field.
 * @returns {Object} A `$group` stage.
 * @throws {TypeError} If `field` is not a non-empty string.
 * @example
 * countBy("category");
 * // → { $group: { _id: "$category", count: { $sum: 1 } } }
 */
export function countBy(field, as = "count") {
  const ref = fieldRef(field);
  return groupBy(ref, { [as]: { $sum: 1 } });
}

/**
 * Build a `$group` stage that averages `field`, optionally grouped by
 * `groupField`.
 *
 * @param {string} field                   The numeric field to average.
 * @param {?string} [groupField=null]      Field to group by, or `null` for the
 *   whole-collection average.
 * @param {string} [as="average"]          Name of the output average field.
 * @returns {Object} A `$group` stage.
 * @throws {TypeError} If `field` is not a non-empty string.
 * @example
 * averageBy("amount", "category");
 * // → { $group: { _id: "$category", average: { $avg: "$amount" } } }
 */
export function averageBy(field, groupField = null, as = "average") {
  const ref = fieldRef(field);
  return groupBy(groupField, { [as]: { $avg: ref } });
}

/**
 * Build a `$match` stage from a filter object.
 *
 * @param {Object} filters                 A MongoDB query document.
 * @returns {Object} A `$match` stage.
 * @throws {TypeError} If `filters` is not a plain object.
 * @example
 * matchStage({ status: "paid", amount: { $gte: 10 } });
 * // → { $match: { status: "paid", amount: { $gte: 10 } } }
 */
export function matchStage(filters) {
  assertObject(filters, "filters");
  return { $match: filters };
}

/**
 * Build a `$sort` stage from a sort specification.
 *
 * @param {Object} spec                    A sort spec, e.g. `{ createdAt: -1 }`.
 * @returns {Object} A `$sort` stage.
 * @throws {TypeError} If `spec` is not a non-empty plain object.
 * @example
 * sortStage({ total: -1 });
 * // → { $sort: { total: -1 } }
 */
export function sortStage(spec) {
  assertObject(spec, "spec");
  if (Object.keys(spec).length === 0) {
    throw new TypeError("spec must have at least one sort key");
  }
  return { $sort: spec };
}

/**
 * Build a `$limit` stage.
 *
 * @param {number} n                       A positive integer row cap.
 * @returns {Object} A `$limit` stage.
 * @throws {TypeError} If `n` is not a positive integer.
 * @example
 * limitStage(10); // → { $limit: 10 }
 */
export function limitStage(n) {
  if (!Number.isInteger(n) || n <= 0) {
    throw new TypeError("limit must be a positive integer");
  }
  return { $limit: n };
}

/**
 * Build a `$skip` stage.
 *
 * @param {number} n                       A non-negative integer offset.
 * @returns {Object} A `$skip` stage.
 * @throws {TypeError} If `n` is not a non-negative integer.
 * @example
 * skipStage(20); // → { $skip: 20 }
 */
export function skipStage(n) {
  if (!Number.isInteger(n) || n < 0) {
    throw new TypeError("skip must be a non-negative integer");
  }
  return { $skip: n };
}

/**
 * Build an offset-pagination stage pair (`$skip` then `$limit`) for a 1-based
 * page number.
 *
 * @param {number} [page=1]                1-based page number.
 * @param {number} [limit=20]             Page size (positive integer).
 * @returns {Object[]} A two-stage array: `[ { $skip }, { $limit } ]`.
 * @throws {TypeError} If `page` is not a positive integer or `limit` is invalid.
 * @example
 * paginate(2, 10); // → [ { $skip: 10 }, { $limit: 10 } ]
 */
export function paginate(page = 1, limit = 20) {
  if (!Number.isInteger(page) || page <= 0) {
    throw new TypeError("page must be a positive integer");
  }
  const limitPart = limitStage(limit);
  return [skipStage((page - 1) * limit), limitPart];
}

/**
 * Build the `$group` **key expression** that buckets a date field by the given
 * granularity. This returns the value you would place at `_id` inside a
 * `$group` stage (not a full stage).
 *
 * See the module header for the exact `$dateToString` formats and rationale.
 *
 * @param {string} dateField               The date field to bucket.
 * @param {Granularity} granularity        `daily`, `weekly` or `monthly`.
 * @param {string} [timezone="UTC"]        IANA timezone (or fixed offset).
 * @returns {Object} A `$dateToString` expression usable as a `$group._id`.
 * @throws {TypeError} If `dateField` is invalid or `granularity` is unsupported.
 * @example
 * dateGroup("createdAt", "monthly");
 * // → { $dateToString: { format: "%Y-%m", date: "$createdAt", timezone: "UTC" } }
 */
export function dateGroup(dateField, granularity, timezone = "UTC") {
  const ref = fieldRef(dateField);
  const format = GRANULARITY_FORMATS[granularity];
  if (!format) {
    throw new TypeError(
      `granularity must be one of ${Object.keys(GRANULARITY_FORMATS).join(", ")}; got "${granularity}"`
    );
  }
  if (typeof timezone !== "string" || timezone.trim() === "") {
    throw new TypeError("timezone must be a non-empty string");
  }
  return { $dateToString: { format, date: ref, timezone } };
}

/**
 * Build a full time-series pipeline: bucket documents by a date field, apply an
 * aggregation to each bucket, then sort the buckets ascending (chronological).
 *
 * The output documents have the shape `{ _id: <bucketKey>, value: <number> }`,
 * ordered from earliest bucket to latest.
 *
 * @param {string} dateField               The date field to bucket by.
 * @param {TimeSeriesOptions} options      Bucketing/aggregation options.
 * @returns {Object[]} A ready-to-run aggregation pipeline.
 * @throws {TypeError} If inputs are invalid (bad granularity/op, or a missing
 *   `valueField` for a non-count op).
 * @example
 * timeSeries("createdAt", { granularity: "daily", valueField: "amount", op: "sum" });
 * // → [
 * //     { $group: { _id: { $dateToString: {...} }, value: { $sum: "$amount" } } },
 * //     { $sort: { _id: 1 } },
 * //   ]
 * @example
 * timeSeries("createdAt", { granularity: "monthly", op: "count" });
 * // counts documents per month
 */
export function timeSeries(dateField, options) {
  assertObject(options, "options");
  const { granularity, valueField, op = "sum", timezone = "UTC" } = options;

  const key = dateGroup(dateField, granularity, timezone);

  let accumulator;
  if (op === "count") {
    accumulator = { $sum: 1 };
  } else {
    const operator = OP_OPERATORS[op];
    if (!operator) {
      throw new TypeError(
        `op must be one of ${[...Object.keys(OP_OPERATORS), "count"].join(", ")}; got "${op}"`
      );
    }
    if (typeof valueField !== "string" || valueField.trim() === "") {
      throw new TypeError(`op "${op}" requires a valueField`);
    }
    accumulator = { [operator]: fieldRef(valueField) };
  }

  return [
    { $group: { _id: key, value: accumulator } },
    { $sort: { _id: 1 } },
  ];
}

/**
 * @typedef {Object} BuildPipelineSpec
 * @property {Object} [match]              Filter for a leading `$match` stage.
 * @property {(Object|Object[])} [group]   A `$group` stage (or its inner
 *   document, e.g. `{ _id, total }`), or an array of stages to inline.
 * @property {Object} [sort]              Sort spec for a `$sort` stage.
 * @property {number} [skip]              Non-negative `$skip` offset.
 * @property {number} [limit]             Positive `$limit` cap.
 */

/**
 * Compose a pipeline from named parts, inserting stages in the canonical order
 * `$match → $group → $sort → $skip → $limit` and omitting any part that is
 * absent/empty.
 *
 * The `group` part is flexible: pass a full `{ $group: {...} }` stage (as
 * returned by {@link groupBy}/{@link sumBy}/…), the bare inner group document
 * `{ _id, ... }`, or an array of stages to inline verbatim.
 *
 * @param {BuildPipelineSpec} [spec={}]    The pipeline parts.
 * @returns {Object[]} The composed aggregation pipeline.
 * @throws {TypeError} If any provided part is malformed.
 * @example
 * buildPipeline({
 *   match: { status: "paid" },
 *   group: sumBy("amount", "category"),
 *   sort: { total: -1 },
 *   limit: 5,
 * });
 * // → [ { $match }, { $group }, { $sort }, { $limit } ]
 */
export function buildPipeline({ match, group, sort, skip, limit } = {}) {
  const pipeline = [];

  if (match !== undefined && match !== null) {
    assertObject(match, "match");
    if (Object.keys(match).length > 0) {
      pipeline.push(matchStage(match));
    }
  }

  if (group !== undefined && group !== null) {
    if (Array.isArray(group)) {
      pipeline.push(...group);
    } else {
      assertObject(group, "group");
      if (Object.keys(group).length > 0) {
        // Accept either a full `{ $group: {...} }` stage or a bare group body.
        pipeline.push("$group" in group ? group : { $group: group });
      }
    }
  }

  if (sort !== undefined && sort !== null) {
    assertObject(sort, "sort");
    if (Object.keys(sort).length > 0) {
      pipeline.push(sortStage(sort));
    }
  }

  if (skip !== undefined && skip !== null) {
    pipeline.push(skipStage(skip));
  }

  if (limit !== undefined && limit !== null) {
    pipeline.push(limitStage(limit));
  }

  return pipeline;
}

/**
 * Default export mirrors the named exports for callers that prefer a namespace
 * import: `import aggregation from "../utils/aggregation.js"`.
 */
export default {
  groupBy,
  sumBy,
  countBy,
  averageBy,
  matchStage,
  sortStage,
  limitStage,
  skipStage,
  paginate,
  dateGroup,
  timeSeries,
  buildPipeline,
};
