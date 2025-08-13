#!/bin/bash

# Setup automated monitoring via cron jobs

SCRIPT_DIR="/home/nigel/Developer/gnaf-address-service"

echo "Setting up automated monitoring cron jobs..."

# Create cron jobs
(crontab -l 2>/dev/null; echo "# GNAF Docker Container Log Monitoring") | crontab -
(crontab -l 2>/dev/null; echo "0 */6 * * * $SCRIPT_DIR/monitor-container-logs.sh >> /var/log/docker-monitor.log 2>&1") | crontab -
(crontab -l 2>/dev/null; echo "0 2 * * * $SCRIPT_DIR/elasticsearch-cleanup.sh >> /var/log/elasticsearch-cleanup.log 2>&1") | crontab -

echo "Cron jobs added:"
echo "- Container log monitoring: Every 6 hours"
echo "- Elasticsearch cleanup: Daily at 2 AM"
echo ""
echo "View logs with:"
echo "  tail -f /var/log/docker-monitor.log"
echo "  tail -f /var/log/elasticsearch-cleanup.log"
echo ""
echo "View scheduled jobs: crontab -l"