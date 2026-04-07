-- Cortex Hub live data-quality audit
-- Run against the live SQLite database:
--   sqlite3 /path/to/cortex.db < .docs/database/data-quality-audit.sql
--
-- Focus:
-- 1. knowledge_documents.project_id canonicalization
-- 2. project readiness for Graph / Knowledge pages
-- 3. runtime-table project linkage drift
-- 4. suspicious "looks indexed but not really" rows
--
-- Notes:
-- - knowledge_documents.project_id is expected to store project slugs in current app flow.
-- - GitNexus duplicate repo aliases (for example "cortex-hub" and "proj-44576c69")
--   are not stored in SQLite; those need separate GitNexus registry inspection.

.headers on
.mode column

SELECT 'A1. project count by org' AS section;
SELECT
  o.slug AS org_slug,
  COUNT(*) AS project_count
FROM projects p
JOIN organizations o ON o.id = p.org_id
GROUP BY o.slug
ORDER BY project_count DESC, o.slug ASC;

SELECT 'A2. projects readiness summary' AS section;
WITH latest_jobs AS (
  SELECT j.*
  FROM index_jobs j
  JOIN (
    SELECT project_id, MAX(created_at) AS max_created_at
    FROM index_jobs
    GROUP BY project_id
  ) latest
    ON latest.project_id = j.project_id
   AND latest.max_created_at = j.created_at
),
knowledge_stats AS (
  SELECT
    project_id,
    COUNT(*) AS docs,
    COALESCE(SUM(chunk_count), 0) AS chunks
  FROM knowledge_documents
  WHERE status = 'active'
  GROUP BY project_id
)
SELECT
  p.id,
  p.slug,
  p.name,
  p.git_repo_url,
  p.indexed_at,
  lj.branch AS latest_branch,
  lj.status AS latest_job_status,
  lj.completed_at AS latest_completed_at,
  COALESCE(ks.docs, 0) AS knowledge_docs,
  COALESCE(ks.chunks, 0) AS knowledge_chunks
FROM projects p
LEFT JOIN latest_jobs lj ON lj.project_id = p.id
LEFT JOIN knowledge_stats ks
  ON ks.project_id = p.slug OR ks.project_id = p.id
ORDER BY
  CASE
    WHEN lj.branch IS NOT NULL AND p.git_repo_url IS NOT NULL THEN 0
    WHEN p.git_repo_url IS NOT NULL THEN 1
    WHEN lj.status IN ('pending', 'cloning', 'analyzing', 'ingesting') THEN 2
    WHEN p.indexed_at IS NOT NULL THEN 3
    ELSE 4
  END,
  LOWER(p.name) ASC;

SELECT 'B1. knowledge docs with NULL / empty project_id' AS section;
SELECT
  id,
  title,
  source,
  project_id,
  created_at,
  updated_at
FROM knowledge_documents
WHERE status = 'active'
  AND (project_id IS NULL OR TRIM(project_id) = '')
ORDER BY updated_at DESC;

SELECT 'B2. knowledge docs whose project_id does not match any project slug' AS section;
SELECT
  kd.id,
  kd.title,
  kd.project_id,
  kd.source,
  kd.updated_at
FROM knowledge_documents kd
LEFT JOIN projects p ON p.slug = kd.project_id
WHERE kd.status = 'active'
  AND kd.project_id IS NOT NULL
  AND TRIM(kd.project_id) != ''
  AND p.id IS NULL
ORDER BY LOWER(kd.project_id), kd.updated_at DESC;

SELECT 'B3. knowledge docs still pointing at proj-* ids instead of slugs' AS section;
SELECT
  kd.id,
  kd.title,
  kd.project_id,
  p.slug AS expected_slug,
  kd.updated_at
FROM knowledge_documents kd
JOIN projects p ON p.id = kd.project_id
WHERE kd.status = 'active'
ORDER BY kd.updated_at DESC;

SELECT 'B4. knowledge docs grouped by project ref' AS section;
SELECT
  COALESCE(NULLIF(TRIM(project_id), ''), '(global)') AS project_ref,
  COUNT(*) AS docs,
  COALESCE(SUM(chunk_count), 0) AS chunks,
  MAX(updated_at) AS last_updated
FROM knowledge_documents
WHERE status = 'active'
GROUP BY COALESCE(NULLIF(TRIM(project_id), ''), '(global)')
ORDER BY docs DESC, project_ref ASC;

SELECT 'C1. duplicate or conflicting project slugs / git urls' AS section;
SELECT
  'slug' AS kind,
  slug AS value,
  COUNT(*) AS duplicates
FROM projects
GROUP BY slug
HAVING COUNT(*) > 1
UNION ALL
SELECT
  'git_repo_url' AS kind,
  git_repo_url AS value,
  COUNT(*) AS duplicates
FROM projects
WHERE git_repo_url IS NOT NULL AND TRIM(git_repo_url) != ''
GROUP BY git_repo_url
HAVING COUNT(*) > 1
ORDER BY kind, duplicates DESC, value ASC;

SELECT 'C2. suspicious projects: no git_repo_url but has index timestamps / jobs / knowledge' AS section;
WITH latest_jobs AS (
  SELECT j.*
  FROM index_jobs j
  JOIN (
    SELECT project_id, MAX(created_at) AS max_created_at
    FROM index_jobs
    GROUP BY project_id
  ) latest
    ON latest.project_id = j.project_id
   AND latest.max_created_at = j.created_at
),
knowledge_stats AS (
  SELECT
    project_id,
    COUNT(*) AS docs
  FROM knowledge_documents
  WHERE status = 'active'
  GROUP BY project_id
)
SELECT
  p.id,
  p.slug,
  p.name,
  p.git_repo_url,
  p.indexed_at,
  lj.branch AS latest_branch,
  lj.status AS latest_job_status,
  lj.completed_at,
  COALESCE(ks.docs, 0) AS knowledge_docs
FROM projects p
LEFT JOIN latest_jobs lj ON lj.project_id = p.id
LEFT JOIN knowledge_stats ks
  ON ks.project_id = p.slug OR ks.project_id = p.id
WHERE (p.git_repo_url IS NULL OR TRIM(p.git_repo_url) = '')
  AND (
    p.indexed_at IS NOT NULL OR
    lj.project_id IS NOT NULL OR
    COALESCE(ks.docs, 0) > 0
  )
ORDER BY LOWER(p.slug);

SELECT 'C3. suspicious projects: indexed_at exists but latest branch is NULL' AS section;
WITH latest_jobs AS (
  SELECT j.*
  FROM index_jobs j
  JOIN (
    SELECT project_id, MAX(created_at) AS max_created_at
    FROM index_jobs
    GROUP BY project_id
  ) latest
    ON latest.project_id = j.project_id
   AND latest.max_created_at = j.created_at
)
SELECT
  p.id,
  p.slug,
  p.name,
  p.git_repo_url,
  p.indexed_at,
  lj.status AS latest_job_status,
  lj.branch AS latest_branch
FROM projects p
LEFT JOIN latest_jobs lj ON lj.project_id = p.id
WHERE p.indexed_at IS NOT NULL
  AND (lj.branch IS NULL OR TRIM(lj.branch) = '')
ORDER BY p.indexed_at DESC;

SELECT 'D1. session_handoffs invalid project linkage' AS section;
SELECT
  sh.id,
  sh.project,
  sh.project_id,
  sh.status,
  sh.created_at
FROM session_handoffs sh
LEFT JOIN projects p ON p.id = sh.project_id
WHERE sh.project_id IS NOT NULL
  AND TRIM(sh.project_id) != ''
  AND p.id IS NULL
ORDER BY sh.created_at DESC
LIMIT 100;

SELECT 'D2. query_logs invalid project linkage' AS section;
SELECT
  ql.id,
  ql.project_id,
  ql.agent_id,
  ql.tool,
  ql.created_at
FROM query_logs ql
LEFT JOIN projects p ON p.id = ql.project_id
WHERE ql.project_id IS NOT NULL
  AND TRIM(ql.project_id) != ''
  AND p.id IS NULL
ORDER BY ql.created_at DESC
LIMIT 100;

SELECT 'D3. quality_reports invalid project linkage' AS section;
SELECT
  qr.id,
  qr.project_id,
  qr.agent_id,
  qr.gate_name,
  qr.created_at
FROM quality_reports qr
LEFT JOIN projects p ON p.id = qr.project_id
WHERE qr.project_id IS NOT NULL
  AND TRIM(qr.project_id) != ''
  AND p.id IS NULL
ORDER BY qr.created_at DESC
LIMIT 100;
