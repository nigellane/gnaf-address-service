#!/bin/bash

# Elasticsearch Index Cleanup Script
# Deletes indices older than 7 days

ELASTICSEARCH_URL="http://localhost:9200"
RETENTION_DAYS=7

echo "Starting Elasticsearch index cleanup..."

# Get current date minus retention days
CUTOFF_DATE=$(date -d "${RETENTION_DAYS} days ago" +%Y.%m.%d)
echo "Deleting indices older than: ${CUTOFF_DATE}"

# Delete old gnaf-logs indices
curl -s "${ELASTICSEARCH_URL}/_cat/indices/gnaf-logs-*" | while read line; do
    INDEX_NAME=$(echo $line | awk '{print $3}')
    INDEX_DATE=$(echo $INDEX_NAME | grep -o '[0-9]\{4\}\.[0-9]\{2\}\.[0-9]\{2\}')
    
    if [[ ! -z "$INDEX_DATE" ]] && [[ "$INDEX_DATE" < "$CUTOFF_DATE" ]]; then
        echo "Deleting index: $INDEX_NAME ($INDEX_DATE)"
        curl -X DELETE "${ELASTICSEARCH_URL}/${INDEX_NAME}"
        echo ""
    fi
done

# Delete old gnaf-alerts indices
curl -s "${ELASTICSEARCH_URL}/_cat/indices/gnaf-alerts-*" | while read line; do
    INDEX_NAME=$(echo $line | awk '{print $3}')
    INDEX_DATE=$(echo $INDEX_NAME | grep -o '[0-9]\{4\}\.[0-9]\{2\}\.[0-9]\{2\}')
    
    if [[ ! -z "$INDEX_DATE" ]] && [[ "$INDEX_DATE" < "$CUTOFF_DATE" ]]; then
        echo "Deleting index: $INDEX_NAME ($INDEX_DATE)"
        curl -X DELETE "${ELASTICSEARCH_URL}/${INDEX_NAME}"
        echo ""
    fi
done

echo "Cleanup completed!"