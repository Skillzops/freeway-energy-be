#!/usr/bin/env bash

set -euo pipefail

############################################
# CONFIG
############################################

MONGO_URI="${MONGO_URI:-mongodb+srv://....}" ### IMPORTANT: Set your MongoDB URI here or via environment variable
DATABASE_NAME="${DATABASE_NAME:-admin}"  ### IMPORTANT: Set your MongoDB database name here or via environment variable
COLLECTIONS="${1:-}"

# BACKUP_ROOT="./mongo_backups"
BACKUP_ROOT="${HOME}/Downloads/mongodb_dumps"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_DIR="$BACKUP_ROOT/$TIMESTAMP"

LOG_FILE="$BACKUP_DIR/backup.log"
SUCCESS_LOG="$BACKUP_DIR/success.log"
ERROR_LOG="$BACKUP_DIR/error.log"

MAX_RETRIES=3
TIMEOUT_SECONDS=120

############################################
# VALIDATION
############################################

if [ -z "$COLLECTIONS" ]; then
  echo "❌ No collections provided."
  echo "Usage: ./dump.sh \"collection1,collection2\""
  exit 1
fi

############################################
# SETUP
############################################

mkdir -p "$BACKUP_DIR"
touch "$LOG_FILE" "$SUCCESS_LOG" "$ERROR_LOG"

print_info()    { echo -e "ℹ️  $1" | tee -a "$LOG_FILE"; }
print_success() { echo -e "✅ $1" | tee -a "$LOG_FILE" "$SUCCESS_LOG"; }
print_warning() { echo -e "⚠️  $1" | tee -a "$LOG_FILE"; }
print_error()   { echo -e "❌ $1" | tee -a "$LOG_FILE" "$ERROR_LOG"; }

############################################
# SPLIT COLLECTIONS
############################################

IFS=',' read -ra COLLECTION_ARRAY <<< "$COLLECTIONS"

############################################
# DUMP FUNCTION
############################################

dump_collection() {
  local collection="$1"
  local attempt=1
  local success=false
  local output_dir="$BACKUP_DIR"

  # Skip system collections
  if [[ "$collection" == system.* ]]; then
    print_warning "Skipping system collection: $collection"
    return
  fi

  while [ $attempt -le $MAX_RETRIES ]; do
    print_info "▶ Dumping collection: $collection (Attempt $attempt/$MAX_RETRIES)"

    local temp_log="$BACKUP_DIR/${collection}_dump.log"

    set +e
    timeout "$TIMEOUT_SECONDS" mongodump \
      --uri="$MONGO_URI" \
      --db="$DATABASE_NAME" \
      --collection="$collection" \
      --out="$output_dir" \
      --quiet > "$temp_log" 2>&1
    exit_code=$?
    set -e

    if [ $exit_code -eq 0 ]; then
      BSON_FILE="$output_dir/$DATABASE_NAME/$collection.bson"

      if [ -s "$BSON_FILE" ]; then
        SIZE=$(du -h "$BSON_FILE" | cut -f1)
        print_success "Dumped: $collection ($SIZE)"
        success=true
        break
      else
        print_warning "Empty dump for $collection"
      fi
    else
      print_warning "Attempt $attempt failed for $collection (exit code: $exit_code)"
    fi

    attempt=$((attempt + 1))
    sleep 2
  done

  if [ "$success" = false ]; then
    print_error "Failed to dump: $collection after $MAX_RETRIES attempts"
  fi
}

############################################
# START DUMP
############################################

print_info "Starting MongoDB collection dump"
print_info "Database: $DATABASE_NAME"
print_info "Collections: $COLLECTIONS"
print_info "Backup directory: $BACKUP_DIR"

for collection in "${COLLECTION_ARRAY[@]}"; do
  dump_collection "$collection"
done

print_info "Dump completed."

############################################
# SUMMARY
############################################

SUCCESS_COUNT=$(wc -l < "$SUCCESS_LOG" || echo 0)
ERROR_COUNT=$(wc -l < "$ERROR_LOG" || echo 0)

echo
echo "=============================="
echo "Backup Summary"
echo "=============================="
echo "Successful: $SUCCESS_COUNT"
echo "Failed:     $ERROR_COUNT"
echo "Location:   $BACKUP_DIR"
echo "=============================="


# Usage ./mongo-dump.sh "devices,token,sales,sales_items,users"