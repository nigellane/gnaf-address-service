#!/bin/bash

echo "🔍 Checking Monitoring Stack Status..."

# Check if services are running
echo "📊 Checking Prometheus..."
curl -s http://localhost:9090/-/healthy >/dev/null && echo "✅ Prometheus: Healthy" || echo "❌ Prometheus: Not running"

echo "📈 Checking Grafana..."
curl -s http://localhost:3002/api/health >/dev/null && echo "✅ Grafana: Healthy" || echo "❌ Grafana: Not running"

echo "🔍 Checking Kibana..."
curl -s http://localhost:5601/api/status >/dev/null && echo "✅ Kibana: Healthy" || echo "❌ Kibana: Not running"

echo "📋 Checking Elasticsearch..."
curl -s http://localhost:9200/_cluster/health >/dev/null && echo "✅ Elasticsearch: Healthy" || echo "❌ Elasticsearch: Not running"

echo "🎯 Checking GNAF App Metrics..."
curl -s http://localhost:3000/api/v1/health/metrics >/dev/null && echo "✅ GNAF Metrics: Available" || echo "❌ GNAF App: Not running or metrics not available"

echo ""
echo "🚀 Access URLs:"
echo "   App:        http://localhost:3000"
echo "   Prometheus: http://localhost:9090"
echo "   Grafana:    http://localhost:3002 (admin/admin)"
echo "   Kibana:     http://localhost:5601"
echo "   Elasticsearch: http://localhost:9200"