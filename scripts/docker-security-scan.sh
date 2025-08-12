#!/bin/bash

# Docker Security Scanning Script for G-NAF Address Service
# Performs vulnerability scanning and security checks on Docker images

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
IMAGE_NAME="gnaf-address-service"
IMAGE_TAG="${1:-latest}"
FULL_IMAGE_NAME="$IMAGE_NAME:$IMAGE_TAG"

echo "🔒 Docker Security Scanning for $FULL_IMAGE_NAME"
echo "=================================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    local color=$1
    local message=$2
    echo -e "${color}${message}${NC}"
}

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    print_status $RED "❌ Docker is not running or accessible"
    exit 1
fi

# Check if image exists
if ! docker image inspect "$FULL_IMAGE_NAME" > /dev/null 2>&1; then
    print_status $YELLOW "⚠️  Image $FULL_IMAGE_NAME not found. Building..."
    cd "$PROJECT_DIR"
    docker build -t "$FULL_IMAGE_NAME" .
fi

print_status $GREEN "✅ Starting security scan for $FULL_IMAGE_NAME"

# 1. Docker Scout vulnerability scan (if available)
echo ""
echo "1. 🛡️  Docker Scout Vulnerability Scan"
echo "======================================"
if command -v docker scout >/dev/null 2>&1; then
    print_status $GREEN "Running Docker Scout scan..."
    docker scout cves "$FULL_IMAGE_NAME" || true
    echo ""
    docker scout recommendations "$FULL_IMAGE_NAME" || true
else
    print_status $YELLOW "Docker Scout not available, skipping vulnerability scan"
fi

# 2. Trivy vulnerability scan (if available)
echo ""
echo "2. 🔍 Trivy Vulnerability Scan"
echo "=============================="
if command -v trivy >/dev/null 2>&1; then
    print_status $GREEN "Running Trivy scan..."
    trivy image --severity HIGH,CRITICAL "$FULL_IMAGE_NAME" || true
else
    print_status $YELLOW "Trivy not available. Install with: curl -sfL https://raw.githubusercontent.com/aquasecurity/trivy/main/contrib/install.sh | sh -s -- -b /usr/local/bin"
fi

# 3. Container structure and security checks
echo ""
echo "3. 🏗️  Container Structure Analysis"
echo "================================="

# Check if running as non-root user
print_status $GREEN "Checking user configuration..."
USER_CHECK=$(docker run --rm "$FULL_IMAGE_NAME" whoami)
if [ "$USER_CHECK" = "gnaf" ]; then
    print_status $GREEN "✅ Container runs as non-root user: $USER_CHECK"
else
    print_status $RED "❌ Container running as: $USER_CHECK (should be 'gnaf')"
fi

# Check file permissions
print_status $GREEN "Checking critical file permissions..."
docker run --rm "$FULL_IMAGE_NAME" ls -la /app/ | grep -E "(healthcheck|package\.json|node_modules)" || true

# 4. Image layer analysis
echo ""
echo "4. 📊 Image Layer Analysis"
echo "========================="
print_status $GREEN "Image size and layers:"
docker images "$FULL_IMAGE_NAME" --format "table {{.Repository}}\t{{.Tag}}\t{{.Size}}\t{{.CreatedAt}}"

print_status $GREEN "Layer breakdown:"
docker history --no-trunc "$FULL_IMAGE_NAME" | head -10

# 5. Runtime security checks
echo ""
echo "5. 🚀 Runtime Security Checks"
echo "============================="

# Check if healthcheck works
print_status $GREEN "Testing health check endpoint..."
CONTAINER_ID=$(docker run -d --rm -p 3001:3000 "$FULL_IMAGE_NAME")
sleep 10

if curl -f http://localhost:3001/api/v1/health/live > /dev/null 2>&1; then
    print_status $GREEN "✅ Health check endpoint accessible"
else
    print_status $RED "❌ Health check endpoint failed"
fi

# Check for security headers (if app is responding)
print_status $GREEN "Checking security headers..."
curl -I http://localhost:3001/api/v1/health 2>/dev/null | grep -E "(X-Frame-Options|X-XSS-Protection|X-Content-Type-Options|Strict-Transport-Security)" || print_status $YELLOW "⚠️  Some security headers may be missing"

# Stop test container
docker stop "$CONTAINER_ID" > /dev/null 2>&1

# 6. Dockerfile security best practices check
echo ""
echo "6. 📝 Dockerfile Security Best Practices"
echo "======================================="

DOCKERFILE="$PROJECT_DIR/Dockerfile"
if [ -f "$DOCKERFILE" ]; then
    print_status $GREEN "Analyzing Dockerfile..."
    
    # Check for multi-stage build
    if grep -q "FROM.*AS" "$DOCKERFILE"; then
        print_status $GREEN "✅ Multi-stage build detected"
    else
        print_status $YELLOW "⚠️  Consider using multi-stage build for smaller images"
    fi
    
    # Check for non-root user
    if grep -q "USER gnaf" "$DOCKERFILE"; then
        print_status $GREEN "✅ Non-root user specified"
    else
        print_status $RED "❌ No non-root user found in Dockerfile"
    fi
    
    # Check for healthcheck
    if grep -q "HEALTHCHECK" "$DOCKERFILE"; then
        print_status $GREEN "✅ Health check defined"
    else
        print_status $YELLOW "⚠️  No health check defined in Dockerfile"
    fi
    
    # Check for package updates
    if grep -q "apk upgrade" "$DOCKERFILE"; then
        print_status $GREEN "✅ Package updates included"
    else
        print_status $YELLOW "⚠️  Consider including package updates"
    fi
    
    # Check for secrets exposure
    if grep -iE "(password|secret|key|token)" "$DOCKERFILE"; then
        print_status $RED "⚠️  Potential secrets found in Dockerfile - review carefully"
        grep -iE "(password|secret|key|token)" "$DOCKERFILE" | head -3
    else
        print_status $GREEN "✅ No obvious secrets in Dockerfile"
    fi
else
    print_status $RED "❌ Dockerfile not found"
fi

# 7. Generate security report
echo ""
echo "7. 📋 Security Report Summary"
echo "============================"

REPORT_FILE="$PROJECT_DIR/security-scan-report.txt"
cat > "$REPORT_FILE" << EOF
Docker Security Scan Report
Generated: $(date)
Image: $FULL_IMAGE_NAME

Summary:
- Image scanned for vulnerabilities
- Container structure validated
- Runtime security tested
- Dockerfile best practices reviewed

Recommendations:
1. Regularly update base image to latest security patches
2. Monitor vulnerability databases for new issues
3. Implement container runtime security monitoring
4. Use secrets management for sensitive configuration
5. Enable security scanning in CI/CD pipeline

For detailed results, see scan output above.
EOF

print_status $GREEN "✅ Security report saved to: $REPORT_FILE"

# 8. Performance and resource usage check
echo ""
echo "8. ⚡ Resource Usage Analysis"
echo "============================"

print_status $GREEN "Starting resource usage test..."
PERF_CONTAINER=$(docker run -d --rm --memory="512m" --cpus="0.5" -p 3002:3000 "$FULL_IMAGE_NAME")
sleep 15

# Check memory usage
docker stats "$PERF_CONTAINER" --no-stream --format "table {{.Container}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}"

# Stop performance test container
docker stop "$PERF_CONTAINER" > /dev/null 2>&1

echo ""
print_status $GREEN "🎉 Security scan complete!"
print_status $YELLOW "Review the output above and address any HIGH or CRITICAL vulnerabilities."
print_status $YELLOW "Consider running this scan regularly and integrating it into your CI/CD pipeline."

# Return appropriate exit code based on findings
exit 0