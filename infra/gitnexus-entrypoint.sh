#!/bin/bash
# GitNexus - Entrypoint Script
# Starts eval-server immediately, then optionally runs bounded repo analysis in the background.

set -euo pipefail

GITNEXUS_DIR="${HOME}/.gitnexus"
REPOS_DIR="${GITNEXUS_REPOS_DIR:-/app/data/repos}"
PORT="${PORT:-4848}"
LOCK_FILE="${GITNEXUS_ANALYZE_LOCK_FILE:-/tmp/gitnexus-index.lock}"

# Keep GitNexus within small-container memory budgets. This caps Node's V8 heap;
# it does not reserve RAM, but it prevents a single process from growing forever.
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=2048}"

# Low-load defaults for small hosts/LXCs. Cortex/API owns scheduled indexing.
# Startup discovery is opt-in because container restarts can otherwise reload
# every repo and repeatedly spike CPU while health checks are still warming up.
GITNEXUS_STARTUP_INDEXING="${GITNEXUS_STARTUP_INDEXING:-false}"
GITNEXUS_AUTO_DISCOVER="${GITNEXUS_AUTO_DISCOVER:-false}"
GITNEXUS_STARTUP_INDEXING_DELAY_SECONDS="${GITNEXUS_STARTUP_INDEXING_DELAY_SECONDS:-15}"
GITNEXUS_AUTO_DISCOVER_MAX_REPOS="${GITNEXUS_AUTO_DISCOVER_MAX_REPOS:-0}"
GITNEXUS_ANALYZE_COOLDOWN_SECONDS="${GITNEXUS_ANALYZE_COOLDOWN_SECONDS:-90}"
GITNEXUS_ANALYZE_TIMEOUT_SECONDS="${GITNEXUS_ANALYZE_TIMEOUT_SECONDS:-900}"
GITNEXUS_ANALYZE_ARGS="${GITNEXUS_ANALYZE_ARGS:---force}"
GITNEXUS_ANALYZE_NICE="${GITNEXUS_ANALYZE_NICE:-15}"
GITNEXUS_ANALYZE_IONICE_CLASS="${GITNEXUS_ANALYZE_IONICE_CLASS:-2}"
GITNEXUS_ANALYZE_IONICE_LEVEL="${GITNEXUS_ANALYZE_IONICE_LEVEL:-7}"

normalize_non_negative_int() {
    local name="$1"
    local default_value="$2"
    local value="${!name:-}"

    if [[ ! "$value" =~ ^[0-9]+$ ]]; then
        printf -v "$name" '%s' "$default_value"
    fi
}

is_truthy() {
    case "${1,,}" in
        1|true|yes|on) return 0 ;;
        *) return 1 ;;
    esac
}

normalize_non_negative_int GITNEXUS_STARTUP_INDEXING_DELAY_SECONDS 15
normalize_non_negative_int GITNEXUS_AUTO_DISCOVER_MAX_REPOS 0
normalize_non_negative_int GITNEXUS_ANALYZE_COOLDOWN_SECONDS 90
normalize_non_negative_int GITNEXUS_ANALYZE_TIMEOUT_SECONDS 900
normalize_non_negative_int GITNEXUS_ANALYZE_NICE 15
normalize_non_negative_int GITNEXUS_ANALYZE_IONICE_CLASS 2
normalize_non_negative_int GITNEXUS_ANALYZE_IONICE_LEVEL 7

has_indexed_repos() {
    if [ -f "${GITNEXUS_DIR}/registry.json" ]; then
        node -e "
            const r = require('${GITNEXUS_DIR}/registry.json');
            const repos = Array.isArray(r) ? r : (r.repos || []);
            process.exit(repos.length > 0 ? 0 : 1);
        " 2>/dev/null
        return $?
    fi
    return 1
}

count_registered_repos() {
    if [ -f "${GITNEXUS_DIR}/registry.json" ]; then
        node -e "
            const r = require('${GITNEXUS_DIR}/registry.json');
            const repos = Array.isArray(r) ? r : (r.repos || []);
            console.log(repos.length);
        " 2>/dev/null || echo "0"
    else
        echo "0"
    fi
}

is_repo_registered() {
    local repo_dir="$1"
    local repo_name="$2"

    if [ -d "${repo_dir}/.gitnexus" ]; then
        return 0
    fi

    if [ ! -f "${GITNEXUS_DIR}/registry.json" ]; then
        return 1
    fi

    node - "$repo_dir" "$repo_name" "${GITNEXUS_DIR}/registry.json" <<'NODE' 2>/dev/null
const fs = require('fs');
const [repoDir, repoName, registryPath] = process.argv.slice(2);
const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
const repos = Array.isArray(registry) ? registry : (registry.repos || []);
const normalize = (value) => String(value || '').replace(/\\/g, '/').replace(/\/$/, '');
const targetDir = normalize(repoDir);
const targetName = normalize(repoName);

const found = repos.some((repo) => {
  const values = [
    repo.id,
    repo.name,
    repo.slug,
    repo.alias,
    repo.projectId,
    repo.project_id,
    repo.path,
    repo.repoPath,
    repo.localPath,
    repo.location,
    repo.root,
    repo.dir,
    repo.repoDir,
    repo.storagePath,
  ].map(normalize);

  return values.includes(targetDir) || values.includes(targetName);
});

process.exit(found ? 0 : 1);
NODE
}

run_analyze_command() {
    local cmd=(gitnexus analyze)
    local raw_args=()

    if [ -n "$GITNEXUS_ANALYZE_ARGS" ]; then
        # shellcheck disable=SC2206
        raw_args=($GITNEXUS_ANALYZE_ARGS)
    fi

    for arg in "${raw_args[@]}"; do
        if [ "$arg" = "--embeddings" ]; then
            echo "GitNexus: Skipping --embeddings for entrypoint analyze; Cortex/mem9 owns embeddings."
            continue
        fi
        cmd+=("$arg")
    done

    if command -v timeout >/dev/null 2>&1 && [ "$GITNEXUS_ANALYZE_TIMEOUT_SECONDS" -gt 0 ]; then
        cmd=(timeout "${GITNEXUS_ANALYZE_TIMEOUT_SECONDS}s" "${cmd[@]}")
    fi

    if command -v ionice >/dev/null 2>&1; then
        cmd=(ionice -c "$GITNEXUS_ANALYZE_IONICE_CLASS" -n "$GITNEXUS_ANALYZE_IONICE_LEVEL" "${cmd[@]}")
    fi

    if command -v nice >/dev/null 2>&1; then
        cmd=(nice -n "$GITNEXUS_ANALYZE_NICE" "${cmd[@]}")
    fi

    "${cmd[@]}"
}

run_analyze_with_lock() {
    local repo_dir="$1"
    local repo_name="$2"

    mkdir -p "$(dirname "$LOCK_FILE")"

    if command -v flock >/dev/null 2>&1; then
        (
            flock -n 9 || {
                echo "  ! ${repo_name} - another GitNexus analyze job is running; skipping."
                exit 75
            }

            cd "$repo_dir"
            echo "  -> ${repo_name}: gitnexus analyze ${GITNEXUS_ANALYZE_ARGS} (timeout ${GITNEXUS_ANALYZE_TIMEOUT_SECONDS}s)"
            run_analyze_command
        ) 9>"$LOCK_FILE"
    else
        echo "GitNexus: flock not available; proceeding without cross-process analyze lock."
        cd "$repo_dir"
        echo "  -> ${repo_name}: gitnexus analyze ${GITNEXUS_ANALYZE_ARGS} (timeout ${GITNEXUS_ANALYZE_TIMEOUT_SECONDS}s)"
        run_analyze_command
    fi
}

bootstrap_default_repo() {
    if has_indexed_repos; then
        local before
        before=$(count_registered_repos)
        echo "GitNexus: Found ${before} indexed repo(s) in registry."
        return 0
    fi

    local repo_url="${DEFAULT_REPO:-}"
    if [ -z "$repo_url" ]; then
        echo "GitNexus: No indexed repos found and DEFAULT_REPO is empty. Skipping bootstrap clone."
        return 0
    fi

    echo "GitNexus: No indexed repos found. Bootstrapping default repo..."

    local repo_name
    local repo_path
    repo_name=$(basename "$repo_url" .git)
    repo_path="${REPOS_DIR}/${repo_name}"

    mkdir -p "$REPOS_DIR"

    if [ ! -d "$repo_path/.git" ]; then
        echo "GitNexus: Cloning $repo_url..."
        if ! git clone --depth 1 "$repo_url" "$repo_path" 2>&1; then
            echo "GitNexus: Clone failed; continuing without default repo."
            return 0
        fi
    else
        echo "GitNexus: Repo already cloned at $repo_path"
        (cd "$repo_path" && git pull --ff-only 2>/dev/null) || true
    fi

    if [ -d "$repo_path/.git" ]; then
        echo "GitNexus: Analyzing default repo with bounded low-load settings..."
        if run_analyze_with_lock "$repo_path" "$repo_name"; then
            echo "GitNexus: Default repo indexed successfully."
        else
            echo "GitNexus: Default repo analyze failed; eval-server will keep running."
        fi
    fi
}

run_auto_discovery() {
    if [ ! -d "$REPOS_DIR" ]; then
        echo "GitNexus: Repos directory not found: ${REPOS_DIR}"
        return 0
    fi

    if ! is_truthy "$GITNEXUS_AUTO_DISCOVER"; then
        echo "GitNexus: Auto-discovery disabled (GITNEXUS_AUTO_DISCOVER=false)."
        return 0
    fi

    local max_label="$GITNEXUS_AUTO_DISCOVER_MAX_REPOS"
    if [ "$GITNEXUS_AUTO_DISCOVER_MAX_REPOS" -eq 0 ]; then
        max_label="unlimited"
    fi
    echo "GitNexus: Scanning ${REPOS_DIR} for unregistered repos (max ${max_label} this start, sequential only)..."
    local analyzed=0

    for repo_dir in "$REPOS_DIR"/*/; do
        [ -d "$repo_dir/.git" ] || continue

        local repo_name
        repo_name=$(basename "$repo_dir")

        if is_repo_registered "$repo_dir" "$repo_name"; then
            echo "  ok ${repo_name} - already indexed"
            continue
        fi

        if [ "$GITNEXUS_AUTO_DISCOVER_MAX_REPOS" -gt 0 ] && [ "$analyzed" -ge "$GITNEXUS_AUTO_DISCOVER_MAX_REPOS" ]; then
            echo "GitNexus: Auto-discovery cap reached; remaining repos will wait for the next run."
            break
        fi

        echo "  -> Analyzing ${repo_name} with low-load settings..."
        if run_analyze_with_lock "$repo_dir" "$repo_name"; then
            analyzed=$((analyzed + 1))
            echo "  ok ${repo_name} - indexed successfully"

            if [ "$GITNEXUS_ANALYZE_COOLDOWN_SECONDS" -gt 0 ]; then
                echo "GitNexus: Cooling down for ${GITNEXUS_ANALYZE_COOLDOWN_SECONDS}s before continuing."
                sleep "$GITNEXUS_ANALYZE_COOLDOWN_SECONDS"
            fi
        else
            echo "  fail ${repo_name} - analyze failed or timed out; continuing startup indexing pass."
        fi
    done

    local total
    total=$(count_registered_repos)
    echo "GitNexus: Auto-discovery pass complete. ${analyzed} new repo(s) analyzed. Total registered: ${total}"
}

run_startup_indexing() {
    bootstrap_default_repo
    run_auto_discovery
}

if is_truthy "$GITNEXUS_STARTUP_INDEXING"; then
    (
        echo "GitNexus: Startup indexing enabled; waiting ${GITNEXUS_STARTUP_INDEXING_DELAY_SECONDS}s before bounded background analysis."
        if [ "$GITNEXUS_STARTUP_INDEXING_DELAY_SECONDS" -gt 0 ]; then
            sleep "$GITNEXUS_STARTUP_INDEXING_DELAY_SECONDS"
        fi
        run_startup_indexing
        echo "GitNexus: Background startup indexing finished."
    ) &
    echo "GitNexus: Background startup indexing PID $!."
else
    echo "GitNexus: Startup indexing disabled (GITNEXUS_STARTUP_INDEXING=false)."
fi

echo "GitNexus: Starting eval-server on port $PORT..."
exec gitnexus eval-server --port "$PORT" --idle-timeout "${GITNEXUS_EVAL_IDLE_TIMEOUT_SECONDS:-0}"
