# Query budgets

List and search endpoints must have an explicit result, time, projection, and
sort budget. The reading-group list is the reference implementation:

- page size is clamped by parsePagination to at most 100 documents;
- search input is limited to 100 literal characters, not interpreted as a
  caller-supplied regular expression;
- only createdAt and name sort keys are accepted;
- the query uses a narrow projection and a 5-second MongoDB maxTimeMS;
- filters used by the endpoint have compound indexes for the filter and
  default sort (privacy + createdAt, book + createdAt).

New list or aggregation queries should document their maximum date range,
result size, projection, sort allowlist, and timeout. Add an index for each
production filter/sort combination and verify it with explain("executionStats")
against a representative worst-case dataset before rollout. Query shapes and
duration should be emitted through the existing metrics layer without values,
identifiers, or raw query text.

Index rollout should be staged: create indexes in the background where the
MongoDB version permits, compare explain plans and slow-query rates, then
remove obsolete indexes only after the rollback window. Roll back by reverting
the query change first; retain the new index until traffic confirms it is no
longer needed.
