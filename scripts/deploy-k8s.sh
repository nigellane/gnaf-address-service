#!/bin/bash

# Kubernetes Deployment Script for G-NAF Address Service
# Deploys the complete G-NAF stack to Kubernetes

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
K8S_DIR="$PROJECT_DIR/k8s"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default values
ENVIRONMENT="${1:-production}"
IMAGE_TAG="${2:-latest}"
DRY_RUN="${3:-false}"
SKIP_BUILD="${4:-false}"

# Function to print colored output
print_status() {
    local color=$1
    local message=$2
    echo -e "${color}${message}${NC}"
}

print_banner() {
    echo ""
    print_status $BLUE "=================================="
    print_status $BLUE "$1"
    print_status $BLUE "=================================="
    echo ""
}

# Check prerequisites
check_prerequisites() {
    print_banner "Checking Prerequisites"
    
    # Check kubectl
    if ! command -v kubectl >/dev/null 2>&1; then
        print_status $RED "❌ kubectl not found. Please install kubectl."
        exit 1
    fi
    
    # Check cluster connection
    if ! kubectl cluster-info >/dev/null 2>&1; then
        print_status $RED "❌ Cannot connect to Kubernetes cluster."
        exit 1
    fi
    
    # Check Docker (if not skipping build)
    if [ "$SKIP_BUILD" != "true" ]; then
        if ! command -v docker >/dev/null 2>&1; then
            print_status $RED "❌ Docker not found. Please install Docker or use --skip-build."
            exit 1
        fi
        
        if ! docker info >/dev/null 2>&1; then
            print_status $RED "❌ Docker daemon not running."
            exit 1
        fi
    fi
    
    print_status $GREEN "✅ All prerequisites met"
}

# Build and push Docker image
build_and_push() {
    if [ "$SKIP_BUILD" = "true" ]; then
        print_status $YELLOW "⏭️  Skipping Docker build as requested"
        return
    fi
    
    print_banner "Building Docker Image"
    
    cd "$PROJECT_DIR"
    
    print_status $GREEN "Building gnaf-address-service:$IMAGE_TAG..."
    docker build -t "gnaf-address-service:$IMAGE_TAG" .
    
    print_status $GREEN "✅ Docker image built successfully"
    
    # Tag for registry if not 'latest'
    if [ "$IMAGE_TAG" != "latest" ]; then
        docker tag "gnaf-address-service:$IMAGE_TAG" "gnaf-address-service:latest"
    fi
    
    # Push to registry (uncomment and configure for your registry)
    # print_status $GREEN "Pushing to registry..."
    # docker push "your-registry/gnaf-address-service:$IMAGE_TAG"
}

# Apply Kubernetes manifests
apply_manifests() {
    print_banner "Deploying to Kubernetes"
    
    local dry_run_flag=""
    if [ "$DRY_RUN" = "true" ]; then
        dry_run_flag="--dry-run=client"
        print_status $YELLOW "🔍 Running in dry-run mode"
    fi
    
    # Create namespaces first
    print_status $GREEN "Creating namespaces..."
    kubectl apply $dry_run_flag -f "$K8S_DIR/namespace.yaml"
    
    # Apply secrets (ensure they're created before other resources need them)
    print_status $YELLOW "⚠️  Applying secrets (ensure you've updated the secret values!)..."
    kubectl apply $dry_run_flag -f "$K8S_DIR/secrets.yaml"
    
    # Apply ConfigMaps
    print_status $GREEN "Applying ConfigMaps..."
    kubectl apply $dry_run_flag -f "$K8S_DIR/configmap.yaml"
    
    # Apply database resources
    print_status $GREEN "Deploying PostgreSQL database..."
    kubectl apply $dry_run_flag -f "$K8S_DIR/postgres.yaml"
    
    # Apply Redis cache
    print_status $GREEN "Deploying Redis cache..."
    kubectl apply $dry_run_flag -f "$K8S_DIR/redis.yaml"
    
    # Wait for database services to be ready (skip in dry-run)
    if [ "$DRY_RUN" != "true" ]; then
        print_status $GREEN "Waiting for database services..."
        kubectl wait --for=condition=ready pod -l app=postgres -n gnaf-system --timeout=300s
        kubectl wait --for=condition=ready pod -l app=redis -n gnaf-system --timeout=300s
        print_status $GREEN "✅ Database services are ready"
    fi
    
    # Apply main application
    print_status $GREEN "Deploying G-NAF application..."
    kubectl apply $dry_run_flag -f "$K8S_DIR/gnaf-app.yaml"
    
    # Apply ingress
    print_status $GREEN "Configuring ingress..."
    kubectl apply $dry_run_flag -f "$K8S_DIR/ingress.yaml"
    
    # Apply monitoring stack
    print_status $GREEN "Deploying monitoring stack..."
    kubectl apply $dry_run_flag -f "$K8S_DIR/monitoring.yaml"
    
    print_status $GREEN "✅ All manifests applied successfully"
}

# Wait for deployments
wait_for_deployment() {
    if [ "$DRY_RUN" = "true" ]; then
        print_status $YELLOW "⏭️  Skipping deployment wait in dry-run mode"
        return
    fi
    
    print_banner "Waiting for Deployments"
    
    # Wait for application pods
    print_status $GREEN "Waiting for G-NAF application pods..."
    kubectl wait --for=condition=ready pod -l app=gnaf-address-service -n gnaf-system --timeout=300s
    
    # Wait for monitoring pods
    print_status $GREEN "Waiting for monitoring pods..."
    kubectl wait --for=condition=ready pod -l app=prometheus -n gnaf-monitoring --timeout=300s || true
    kubectl wait --for=condition=ready pod -l app=grafana -n gnaf-monitoring --timeout=300s || true
    
    print_status $GREEN "✅ All deployments are ready"
}

# Verify deployment
verify_deployment() {
    if [ "$DRY_RUN" = "true" ]; then
        print_status $YELLOW "⏭️  Skipping verification in dry-run mode"
        return
    fi
    
    print_banner "Verifying Deployment"
    
    # Check pod status
    print_status $GREEN "Pod status in gnaf-system namespace:"
    kubectl get pods -n gnaf-system -o wide
    
    print_status $GREEN "Pod status in gnaf-monitoring namespace:"
    kubectl get pods -n gnaf-monitoring -o wide
    
    # Check services
    print_status $GREEN "Services:"
    kubectl get services -n gnaf-system
    kubectl get services -n gnaf-monitoring
    
    # Check ingress
    print_status $GREEN "Ingress:"
    kubectl get ingress -n gnaf-system
    
    # Check HPA
    print_status $GREEN "Horizontal Pod Autoscaler:"
    kubectl get hpa -n gnaf-system
    
    # Test health endpoint
    print_status $GREEN "Testing health endpoint..."
    
    # Get service IP for port-forward test
    APP_POD=$(kubectl get pods -n gnaf-system -l app=gnaf-address-service -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
    
    if [ -n "$APP_POD" ]; then
        print_status $GREEN "Testing health check via port-forward..."
        timeout 10s kubectl port-forward -n gnaf-system pod/$APP_POD 8080:3000 >/dev/null 2>&1 &
        PF_PID=$!
        sleep 3
        
        if curl -f http://localhost:8080/api/v1/health/live >/dev/null 2>&1; then
            print_status $GREEN "✅ Health check successful"
        else
            print_status $YELLOW "⚠️  Health check failed (service may still be starting)"
        fi
        
        kill $PF_PID 2>/dev/null || true
    fi
}

# Display connection information
show_connection_info() {
    if [ "$DRY_RUN" = "true" ]; then
        return
    fi
    
    print_banner "Connection Information"
    
    # Get ingress information
    INGRESS_IP=$(kubectl get ingress gnaf-ingress -n gnaf-system -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || echo "pending")
    INGRESS_HOSTNAME=$(kubectl get ingress gnaf-ingress -n gnaf-system -o jsonpath='{.spec.rules[0].host}' 2>/dev/null || echo "api.yourdomain.com")
    
    print_status $GREEN "Application Access:"
    echo "  Public URL: https://$INGRESS_HOSTNAME"
    echo "  Ingress IP: $INGRESS_IP"
    echo "  Health Check: https://$INGRESS_HOSTNAME/api/v1/health"
    echo ""
    
    print_status $GREEN "Direct Access (via kubectl port-forward):"
    echo "  Application: kubectl port-forward -n gnaf-system svc/gnaf-app-service 3000:80"
    echo "  Prometheus: kubectl port-forward -n gnaf-monitoring svc/prometheus-service 9090:9090"
    echo "  Grafana: kubectl port-forward -n gnaf-monitoring svc/grafana-service 3001:3000"
    echo ""
    
    print_status $GREEN "Monitoring Access:"
    echo "  Prometheus: http://localhost:9090 (after port-forward)"
    echo "  Grafana: http://localhost:3001 (after port-forward)"
    echo "  Grafana Login: admin / [password from secret]"
    echo ""
    
    print_status $YELLOW "Next Steps:"
    echo "  1. Update DNS to point $INGRESS_HOSTNAME to $INGRESS_IP"
    echo "  2. Configure SSL certificates (cert-manager recommended)"
    echo "  3. Update secrets with production values"
    echo "  4. Set up persistent volume storage class if needed"
    echo "  5. Configure monitoring alerts and notifications"
}

# Rollback function
rollback_deployment() {
    print_banner "Rolling Back Deployment"
    
    print_status $YELLOW "Rolling back G-NAF application..."
    kubectl rollout undo deployment/gnaf-app-deployment -n gnaf-system
    
    print_status $GREEN "Waiting for rollback to complete..."
    kubectl rollout status deployment/gnaf-app-deployment -n gnaf-system
    
    print_status $GREEN "✅ Rollback completed"
}

# Cleanup function
cleanup_deployment() {
    print_banner "Cleaning Up Deployment"
    
    print_status $YELLOW "⚠️  This will delete all G-NAF resources. Continue? (y/N)"
    read -r response
    if [[ ! "$response" =~ ^([yY][eE][sS]|[yY])$ ]]; then
        print_status $GREEN "Cleanup cancelled"
        return
    fi
    
    print_status $YELLOW "Deleting resources..."
    
    # Delete in reverse order
    kubectl delete -f "$K8S_DIR/monitoring.yaml" || true
    kubectl delete -f "$K8S_DIR/ingress.yaml" || true
    kubectl delete -f "$K8S_DIR/gnaf-app.yaml" || true
    kubectl delete -f "$K8S_DIR/redis.yaml" || true
    kubectl delete -f "$K8S_DIR/postgres.yaml" || true
    kubectl delete -f "$K8S_DIR/configmap.yaml" || true
    kubectl delete -f "$K8S_DIR/secrets.yaml" || true
    kubectl delete -f "$K8S_DIR/namespace.yaml" || true
    
    print_status $GREEN "✅ Cleanup completed"
}

# Main execution
main() {
    print_banner "G-NAF Kubernetes Deployment"
    echo "Environment: $ENVIRONMENT"
    echo "Image Tag: $IMAGE_TAG"
    echo "Dry Run: $DRY_RUN"
    echo "Skip Build: $SKIP_BUILD"
    echo ""
    
    case "${1:-deploy}" in
        deploy)
            check_prerequisites
            build_and_push
            apply_manifests
            wait_for_deployment
            verify_deployment
            show_connection_info
            ;;
        rollback)
            check_prerequisites
            rollback_deployment
            ;;
        cleanup)
            check_prerequisites
            cleanup_deployment
            ;;
        verify)
            check_prerequisites
            verify_deployment
            show_connection_info
            ;;
        *)
            echo "Usage: $0 {deploy|rollback|cleanup|verify} [environment] [image_tag] [dry_run] [skip_build]"
            echo ""
            echo "Commands:"
            echo "  deploy   - Deploy the complete G-NAF stack"
            echo "  rollback - Rollback the application deployment"
            echo "  cleanup  - Delete all G-NAF resources"
            echo "  verify   - Verify current deployment status"
            echo ""
            echo "Options:"
            echo "  environment: production (default) | staging | development"
            echo "  image_tag: Docker image tag (default: latest)"
            echo "  dry_run: true | false (default: false)"
            echo "  skip_build: true | false (default: false)"
            exit 1
            ;;
    esac
}

# Handle special command arguments
if [ "$1" = "rollback" ] || [ "$1" = "cleanup" ] || [ "$1" = "verify" ]; then
    main "$1"
else
    main "deploy" "$@"
fi