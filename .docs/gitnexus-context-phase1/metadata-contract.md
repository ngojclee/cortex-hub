# Shared Metadata Contract

## Goal
Use one canonical metadata shape across sessions, change events, quality reports, memory records, and telemetry.

## Canonical Keys
- `projectId`
- `branch`
- `filesTouched`
- `symbolsTouched`
- `processesAffected`
- `clustersTouched`
- `resourceUris`
- `connection.transport`
- `connection.clientApp`
- `connection.clientHost`
- `connection.clientUserAgent`
- `connection.clientIp`

## Storage Rules
- Persist as JSON in `shared_metadata`
- Use canonical camelCase keys in the JSON payload
- Accept snake_case aliases on input only for normalization

## Current Usage
- `session_handoffs.shared_metadata`
- `quality_reports.shared_metadata`
- `query_logs.shared_metadata`
- `change_events.shared_metadata`
- `mem9` record metadata under `metadata.shared_metadata`

## Notes
- `projectId` and `branch` are the minimum useful link keys
- Arrays should be de-duplicated and omit empty values
- `resourceUris` should point to `cortex://...` resources when possible so different MCP clients can reopen the same context
- `connection.*` is optional but should be filled whenever the runtime can infer it from MCP/API headers
- `connection.clientHost` should only be trusted when explicitly supplied by the client; do not silently reuse server hostnames as if they were operator machines
