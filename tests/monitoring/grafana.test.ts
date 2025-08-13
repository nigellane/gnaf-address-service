/**
 * Grafana Dashboard Configuration Tests
 * Validates dashboard JSON structures and configurations
 */

import fs from 'fs';
import path from 'path';

describe('Grafana Dashboard Configuration', () => {
  const dashboardDir = path.join(__dirname, '../../grafana/dashboards');
  const provisioningDir = path.join(__dirname, '../../grafana/provisioning');

  describe('Dashboard JSON Files', () => {
    const dashboardFiles = [
      'system-overview.json',
      'performance-monitoring.json',
      'cache-performance.json',
      'database-operations.json'
    ];

    dashboardFiles.forEach(filename => {
      describe(`Dashboard: ${filename}`, () => {
        let dashboardConfig: any;

        beforeAll(() => {
          const filePath = path.join(dashboardDir, filename);
          expect(fs.existsSync(filePath)).toBe(true);
          
          const fileContent = fs.readFileSync(filePath, 'utf8');
          dashboardConfig = JSON.parse(fileContent);
        });

        it('should have valid JSON structure', () => {
          expect(dashboardConfig).toBeDefined();
          expect(typeof dashboardConfig).toBe('object');
        });

        it('should have required dashboard properties', () => {
          expect(dashboardConfig).toHaveProperty('title');
          expect(dashboardConfig).toHaveProperty('uid');
          expect(dashboardConfig).toHaveProperty('panels');
          expect(dashboardConfig).toHaveProperty('tags');
          expect(dashboardConfig).toHaveProperty('refresh');
        });

        it('should have G-NAF specific tags', () => {
          expect(dashboardConfig.tags).toContain('gnaf');
          expect(dashboardConfig.tags).toContain('address-service');
        });

        it('should have reasonable refresh rate', () => {
          expect(dashboardConfig.refresh).toMatch(/^(15s|30s|1m|5m)$/);
        });

        it('should have panels with valid structure', () => {
          expect(Array.isArray(dashboardConfig.panels)).toBe(true);
          expect(dashboardConfig.panels.length).toBeGreaterThan(0);

          dashboardConfig.panels.forEach((panel: any, index: number) => {
            expect(panel).toHaveProperty('id', `Panel ${index + 1} should have ID`);
            expect(panel).toHaveProperty('title', `Panel ${index + 1} should have title`);
            expect(panel).toHaveProperty('type', `Panel ${index + 1} should have type`);
            expect(panel).toHaveProperty('targets', `Panel ${index + 1} should have targets`);
            expect(panel).toHaveProperty('gridPos', `Panel ${index + 1} should have gridPos`);
          });
        });

        it('should use Prometheus datasource', () => {
          dashboardConfig.panels.forEach((panel: any) => {
            if (panel.targets && panel.targets.length > 0) {
              panel.targets.forEach((target: any) => {
                if (target.expr) {
                  expect(target.expr).toMatch(/gnaf_/);
                }
              });
            }
          });
        });

        it('should have valid grid positions', () => {
          dashboardConfig.panels.forEach((panel: any, index: number) => {
            expect(panel.gridPos).toHaveProperty('h');
            expect(panel.gridPos).toHaveProperty('w');
            expect(panel.gridPos).toHaveProperty('x');
            expect(panel.gridPos).toHaveProperty('y');

            // Validate reasonable dimensions
            expect(panel.gridPos.h).toBeGreaterThan(0);
            expect(panel.gridPos.w).toBeGreaterThan(0);
            expect(panel.gridPos.w).toBeLessThanOrEqual(24); // Max grid width
            expect(panel.gridPos.x).toBeGreaterThanOrEqual(0);
            expect(panel.gridPos.x).toBeLessThan(24);
          });
        });
      });
    });
  });

  describe('System Overview Dashboard', () => {
    let dashboard: any;

    beforeAll(() => {
      const filePath = path.join(dashboardDir, 'system-overview.json');
      dashboard = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    });

    it('should have system health panels', () => {
      const panelTitles = dashboard.panels.map((p: any) => p.title);
      expect(panelTitles).toContain('System Health Status');
      expect(panelTitles).toContain('Cache Hit Ratio');
      expect(panelTitles).toContain('Response Times');
    });

    it('should monitor key metrics', () => {
      const expressions = dashboard.panels
        .flatMap((p: any) => p.targets || [])
        .map((t: any) => t.expr)
        .filter((expr: string) => expr);

      expect(expressions.some((expr: string) => expr.includes('gnaf_dataset_health'))).toBe(true);
      expect(expressions.some((expr: string) => expr.includes('gnaf_cache_hit_ratio'))).toBe(true);
      expect(expressions.some((expr: string) => expr.includes('gnaf_http_request_duration_seconds'))).toBe(true);
    });
  });

  describe('Performance Monitoring Dashboard', () => {
    let dashboard: any;

    beforeAll(() => {
      const filePath = path.join(dashboardDir, 'performance-monitoring.json');
      dashboard = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    });

    it('should have performance-focused panels', () => {
      const panelTitles = dashboard.panels.map((p: any) => p.title);
      expect(panelTitles).toContain('API Response Times by Endpoint');
      expect(panelTitles).toContain('Address API Throughput');
      expect(panelTitles).toContain('Error Rates by Endpoint');
    });

    it('should include SLA targets', () => {
      const expressions = dashboard.panels
        .flatMap((p: any) => p.targets || [])
        .map((t: any) => t.expr || t.legendFormat)
        .filter(Boolean);

      expect(expressions.some((expr: string) => expr.includes('SLA Target'))).toBe(true);
    });

    it('should have templating for time intervals', () => {
      expect(dashboard.templating).toHaveProperty('list');
      const intervalVar = dashboard.templating.list.find((v: any) => v.name === 'interval');
      expect(intervalVar).toBeDefined();
    });
  });

  describe('Cache Performance Dashboard', () => {
    let dashboard: any;

    beforeAll(() => {
      const filePath = path.join(dashboardDir, 'cache-performance.json');
      dashboard = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    });

    it('should monitor multi-tier cache performance', () => {
      const expressions = dashboard.panels
        .flatMap((p: any) => p.targets || [])
        .map((t: any) => t.expr)
        .filter((expr: string) => expr);

      expect(expressions.some((expr: string) => expr.includes('cache_layer="l1"'))).toBe(true);
      expect(expressions.some((expr: string) => expr.includes('cache_layer="l2"'))).toBe(true);
      expect(expressions.some((expr: string) => expr.includes('cache_layer="overall"'))).toBe(true);
    });

    it('should have cache-specific panels', () => {
      const panelTitles = dashboard.panels.map((p: any) => p.title);
      expect(panelTitles).toContain('Cache Hit Ratios');
      expect(panelTitles).toContain('Cache Response Times');
      expect(panelTitles).toContain('Cache Memory Usage');
    });
  });

  describe('Database Operations Dashboard', () => {
    let dashboard: any;

    beforeAll(() => {
      const filePath = path.join(dashboardDir, 'database-operations.json');
      dashboard = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    });

    it('should monitor database performance', () => {
      const panelTitles = dashboard.panels.map((p: any) => p.title);
      expect(panelTitles).toContain('Database Connection Pool');
      expect(panelTitles).toContain('Database Query Performance');
      expect(panelTitles).toContain('G-NAF Dataset Status');
    });

    it('should include connection pool limits', () => {
      const expressions = dashboard.panels
        .flatMap((p: any) => p.targets || [])
        .map((t: any) => t.expr || t.legendFormat)
        .filter(Boolean);

      expect(expressions.some((expr: string) => expr.includes('Pool Limit'))).toBe(true);
    });
  });

  describe('Provisioning Configuration', () => {
    it('should have dashboard provider configuration', () => {
      const providerPath = path.join(provisioningDir, 'dashboards/dashboard-provider.yaml');
      expect(fs.existsSync(providerPath)).toBe(true);

      const content = fs.readFileSync(providerPath, 'utf8');
      expect(content).toContain('G-NAF Address Service Dashboards');
      expect(content).toContain('apiVersion: 1');
    });

    it('should have Prometheus datasource configuration', () => {
      const datasourcePath = path.join(provisioningDir, 'datasources/prometheus.yaml');
      expect(fs.existsSync(datasourcePath)).toBe(true);

      const content = fs.readFileSync(datasourcePath, 'utf8');
      expect(content).toContain('type: prometheus');
      expect(content).toContain('uid: prometheus');
    });

    it('should have alerting rules configuration', () => {
      const alertingPath = path.join(provisioningDir, 'alerting/gnaf-alerts.yaml');
      expect(fs.existsSync(alertingPath)).toBe(true);

      const content = fs.readFileSync(alertingPath, 'utf8');
      expect(content).toContain('gnaf-service-alerts');
      expect(content).toContain('gnaf-high-response-time');
      expect(content).toContain('gnaf-dataset-unhealthy');
    });
  });

  describe('Alert Rules Validation', () => {
    let alertConfig: any;

    beforeAll(() => {
      const alertPath = path.join(provisioningDir, 'alerting/gnaf-alerts.yaml');
      // Note: This is a simplified test - in reality you'd use a YAML parser
      const content = fs.readFileSync(alertPath, 'utf8');
      
      // Basic validation that it contains expected sections
      expect(content).toContain('groups:');
      expect(content).toContain('rules:');
    });

    it('should define critical alerts', () => {
      const alertPath = path.join(provisioningDir, 'alerting/gnaf-alerts.yaml');
      const content = fs.readFileSync(alertPath, 'utf8');

      // Check for key alerts
      expect(content).toContain('gnaf-high-response-time');
      expect(content).toContain('gnaf-high-error-rate');
      expect(content).toContain('gnaf-dataset-unhealthy');
      expect(content).toContain('gnaf-low-cache-hit-ratio');
      expect(content).toContain('gnaf-db-connections-high');
    });

    it('should have reasonable thresholds', () => {
      const alertPath = path.join(provisioningDir, 'alerting/gnaf-alerts.yaml');
      const content = fs.readFileSync(alertPath, 'utf8');

      // Check for threshold values that make sense
      expect(content).toContain('1.0'); // 1 second response time threshold
      expect(content).toContain('70');  // 70% cache hit ratio threshold
      expect(content).toContain('5');   // 5% error rate threshold
      expect(content).toContain('18');  // 18/20 DB connections threshold
    });
  });

  describe('Template Variables', () => {
    it('should support multi-environment configuration', () => {
      const perfDashboard = JSON.parse(fs.readFileSync(
        path.join(dashboardDir, 'performance-monitoring.json'), 
        'utf8'
      ));

      expect(perfDashboard.templating.list).toBeDefined();
      expect(Array.isArray(perfDashboard.templating.list)).toBe(true);
    });
  });

  describe('Dashboard Consistency', () => {
    const allDashboards = [
      'system-overview.json',
      'performance-monitoring.json', 
      'cache-performance.json',
      'database-operations.json'
    ];

    it('should have consistent UID format', () => {
      allDashboards.forEach(filename => {
        const dashboard = JSON.parse(fs.readFileSync(
          path.join(dashboardDir, filename), 
          'utf8'
        ));
        
        expect(dashboard.uid).toMatch(/^gnaf-/);
        expect(dashboard.uid).toMatch(/^gnaf-[a-z-]+$/);
      });
    });

    it('should have consistent time ranges', () => {
      allDashboards.forEach(filename => {
        const dashboard = JSON.parse(fs.readFileSync(
          path.join(dashboardDir, filename), 
          'utf8'
        ));
        
        expect(dashboard.time.from).toBe('now-1h');
        expect(dashboard.time.to).toBe('now');
      });
    });

    it('should use consistent refresh rates', () => {
      allDashboards.forEach(filename => {
        const dashboard = JSON.parse(fs.readFileSync(
          path.join(dashboardDir, filename), 
          'utf8'
        ));
        
        expect(dashboard.refresh).toBe('30s');
      });
    });
  });
});