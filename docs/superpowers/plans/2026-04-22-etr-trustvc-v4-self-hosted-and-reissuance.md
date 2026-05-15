# ETR TrustVC v4 Self-Hosted Schema Enforcement and Portal ETD Re-Issuance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent any new v3-dependent ETR issuance before the May 15, 2026 cutoff by enforcing TrustVC + self-hosted schema policy (runtime and startup), then deliver Phase 2 portal-only ETD re-issuance that creates a new ETD artifact while preserving the existing `tokenId`.

**Architecture:** Centralize schema/context validation in one ETR policy module and call it from both issuance runtime and startup preflight validation. Remove permissive data-element fallback, enforce HTTPS + per-environment host allowlists, and emit structured audit signals for canary/validation outcomes. Add a dedicated re-issuance linkage model so original and re-issued ETDs can coexist while default retrieval resolves to re-issued artifacts.

**Tech Stack:** Go (Gin, GORM, testify), PostgreSQL-backed stores, existing `PitStopConfigService`, ETR handlers/services, structured error responses.

---

## Scope Check

This is one subsystem (ETR service + its sharelib dependencies) across two phases that share the same issuance/retrieval surface. A single plan is appropriate because Phase 2 re-issuance depends directly on Phase 1 policy primitives and error taxonomy.

## File Structure Map

### Core Policy (Phase 1)

- Create: `dex-monorepo/be/sharelib/services/etr/schema_policy.go`
- Create: `dex-monorepo/be/sharelib/services/etr/schema_policy_test.go`
- Modify: `dex-monorepo/be/sharelib/services/etr/issuance_operations.go`
- Create: `dex-monorepo/be/sharelib/services/etr/issuance_schema_policy_test.go`
- Responsibility: One source of truth for TrustVC context/schema URL policy and error taxonomy.

### Config + Startup Enforcement (Phase 1)

- Modify: `dex-monorepo/be/sharelib/services/constants/constants.go`
- Modify: `dex-monorepo/be/sharelib/services/constants/constants_test.go`
- Modify: `dex-monorepo/be/sharelib/services/pitstop/pitstop.go`
- Create: `dex-monorepo/be/etr/cmd/startup_validation.go`
- Create: `dex-monorepo/be/etr/cmd/startup_validation_test.go`
- Modify: `dex-monorepo/be/etr/cmd/main.go`
- Responsibility: TrustVC env key adoption, OS override support, and startup fail-fast validation.

### Observability + Error Surfacing (Phase 1)

- Create: `dex-monorepo/be/sharelib/services/etr/policy_audit.go`
- Create: `dex-monorepo/be/sharelib/services/etr/policy_audit_test.go`
- Modify: `dex-monorepo/be/etr/internal/handlers/issuance_handlers.go`
- Modify: `dex-monorepo/be/etr/internal/handlers/issuance_handlers_test.go`
- Responsibility: Canary-by-data-element telemetry, policy reason codes, and 4xx mapping for policy failures.

### Re-Issuance Domain + Storage (Phase 2)

- Create: `dex-monorepo/be/sharelib/services/models/transferable_reissuance.go`
- Create: `dex-monorepo/be/sharelib/services/types/transferable_reissuance.store.go`
- Create: `dex-monorepo/be/sharelib/services/store/transferable_reissuance_store.go`
- Modify: `dex-monorepo/be/sharelib/services/types/database.go`
- Modify: `dex-monorepo/be/sharelib/services/database/database.go`
- Create: `dex-monorepo/be/sharelib/services/store/transferable_reissuance_store_test.go`
- Responsibility: Explicit original->reissued linkage and default-target tracking.

### Re-Issuance Service + API (Phase 2)

- Create: `dex-monorepo/be/sharelib/services/etr/reissuance_operations.go`
- Create: `dex-monorepo/be/sharelib/services/etr/reissuance_operations_test.go`
- Modify: `dex-monorepo/be/sharelib/services/types/etr.interface.go`
- Modify: `dex-monorepo/be/sharelib/services/mocks/IETRService.go`
- Create: `dex-monorepo/be/etr/internal/handlers/reissuance_handlers.go`
- Create: `dex-monorepo/be/etr/internal/handlers/reissuance_handlers_test.go`
- Modify: `dex-monorepo/be/etr/internal/routes/routes.go`
- Modify: `dex-monorepo/be/etr/internal/routes/routes_test.go`
- Modify: `dex-monorepo/be/etr/internal/handlers/etr_handlers_test.go`
- Responsibility: Portal-only re-issuance, issuer-org authorization, batch controls, default reissued retrieval.

### Operational Documentation

- Create: `dex-monorepo/docs/ETR_V4_COMPLIANCE_QUERIES.md`
- Responsibility: Concrete KPI queries for `new_v3_issued_count`, `issuance_failure_missing_config_count`, and canary success rates.

## Phase 1 Tasks

### Task 1: Build Schema Policy Error Taxonomy

**Files:**
- Create: `dex-monorepo/be/sharelib/services/etr/schema_policy.go`
- Test: `dex-monorepo/be/sharelib/services/etr/schema_policy_test.go`

- [ ] **Step 1: Write the failing test**

```go
package etr

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestSchemaPolicyError_HasStableCodeAndMessage(t *testing.T) {
	err := &SchemaPolicyError{
		Code:          SchemaPolicyMissingConfig,
		DataElementID: "BILL_OF_LADING",
		ConfigKey:     "ETR_BILL_OF_LADING_SCHEMA_URL",
	}

	assert.Equal(t, SchemaPolicyMissingConfig, err.Code)
	assert.Contains(t, err.Error(), "ETR_BILL_OF_LADING_SCHEMA_URL")
}

func TestParseSchemaHostAllowlist_NormalizesHosts(t *testing.T) {
	hosts, err := parseSchemaHostAllowlist("schema.dev.sgtradex.io, TRUSTVC.IO ")
	assert.NoError(t, err)
	assert.Contains(t, hosts, "schema.dev.sgtradex.io")
	assert.Contains(t, hosts, "trustvc.io")
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/marcusong/Documents/trae_projects/dex-repo/dex-monorepo/be && go test ./sharelib/services/etr -run 'TestSchemaPolicyError_HasStableCodeAndMessage|TestParseSchemaHostAllowlist_NormalizesHosts' -v`
Expected: FAIL with undefined `SchemaPolicyError` and `parseSchemaHostAllowlist`.

- [ ] **Step 3: Write minimal implementation**

```go
package etr

import (
	"fmt"
	"strings"
)

type SchemaPolicyCode string

const (
	SchemaPolicyMissingConfig   SchemaPolicyCode = "MISSING_CONFIG"
	SchemaPolicyUnsupportedDE   SchemaPolicyCode = "UNSUPPORTED_DATA_ELEMENT"
	SchemaPolicyDeprecatedHost  SchemaPolicyCode = "DEPRECATED_HOST"
	SchemaPolicyNonHTTPS        SchemaPolicyCode = "NON_HTTPS_URL"
	SchemaPolicyHostNotAllowed  SchemaPolicyCode = "HOST_NOT_ALLOWLISTED"
	SchemaPolicyInvalidURL      SchemaPolicyCode = "INVALID_URL"
)

type SchemaPolicyError struct {
	Code          SchemaPolicyCode
	DataElementID string
	ConfigKey     string
	URL           string
	Host          string
}

func (e *SchemaPolicyError) Error() string {
	return fmt.Sprintf("etr schema policy failure code=%s dataElement=%s configKey=%s url=%s host=%s",
		e.Code, e.DataElementID, e.ConfigKey, e.URL, e.Host)
}

func parseSchemaHostAllowlist(raw string) (map[string]struct{}, error) {
	result := map[string]struct{}{}
	if strings.TrimSpace(raw) == "" {
		return result, nil
	}
	for _, host := range strings.Split(raw, ",") {
		normalized := strings.ToLower(strings.TrimSpace(host))
		if normalized == "" {
			continue
		}
		result[normalized] = struct{}{}
	}
	return result, nil
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/marcusong/Documents/trae_projects/dex-repo/dex-monorepo/be && go test ./sharelib/services/etr -run 'TestSchemaPolicyError_HasStableCodeAndMessage|TestParseSchemaHostAllowlist_NormalizesHosts' -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add be/sharelib/services/etr/schema_policy.go be/sharelib/services/etr/schema_policy_test.go
git commit -m "feat(etr): add schema policy error taxonomy"
```

### Task 2: Enforce TrustVC Context + Explicit Data-Element Mapping (No Fallback)

**Files:**
- Modify: `dex-monorepo/be/sharelib/services/etr/schema_policy.go`
- Modify: `dex-monorepo/be/sharelib/services/etr/issuance_operations.go`
- Test: `dex-monorepo/be/sharelib/services/etr/schema_policy_test.go`
- Test: `dex-monorepo/be/sharelib/services/etr/issuance_schema_policy_test.go`

- [ ] **Step 1: Write the failing test**

```go
func TestResolveIssuanceContexts_RejectsUnknownDataElement(t *testing.T) {
	_, err := ResolveIssuanceContexts(SchemaPolicyInput{
		DataElementID:      "UNKNOWN_DE",
		TrustVCContextURL:  "https://schema.dev.sgtradex.io/context/trustvc-v4.json",
		SchemaURLByElement: map[string]string{"BILL_OF_LADING": "https://schema.dev.sgtradex.io/bol-context.json"},
		HostAllowlistRaw:   "schema.dev.sgtradex.io",
	})

	assert.Error(t, err)
	policyErr := &SchemaPolicyError{}
	assert.ErrorAs(t, err, &policyErr)
	assert.Equal(t, SchemaPolicyUnsupportedDE, policyErr.Code)
}

func TestResolveIssuanceContexts_RejectsDeprecatedOAHost(t *testing.T) {
	_, err := ResolveIssuanceContexts(SchemaPolicyInput{
		DataElementID:      "BILL_OF_LADING",
		TrustVCContextURL:  "https://www.schemata.openattestation.com/trustvc.json",
		SchemaURLByElement: map[string]string{"BILL_OF_LADING": "https://schema.dev.sgtradex.io/bol-context.json"},
		HostAllowlistRaw:   "schema.dev.sgtradex.io,trustvc.io",
	})

	assert.Error(t, err)
	policyErr := &SchemaPolicyError{}
	assert.ErrorAs(t, err, &policyErr)
	assert.Equal(t, SchemaPolicyDeprecatedHost, policyErr.Code)
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/marcusong/Documents/trae_projects/dex-repo/dex-monorepo/be && go test ./sharelib/services/etr -run 'TestResolveIssuanceContexts_RejectsUnknownDataElement|TestResolveIssuanceContexts_RejectsDeprecatedOAHost' -v`
Expected: FAIL with undefined `ResolveIssuanceContexts` and `SchemaPolicyInput`.

- [ ] **Step 3: Write minimal implementation**

```go
type SchemaPolicyInput struct {
	DataElementID      string
	TrustVCContextURL  string
	SchemaURLByElement map[string]string
	HostAllowlistRaw   string
}

type SchemaPolicyResult struct {
	TrustVCContextURL string
	SchemaURL         string
}

var deprecatedOAHost = "schemata.openattestation.com"
var inScopeElements = map[string]struct{}{
	"EXTERNAL_TRANSPORT_DOCUMENT": {},
	"BILL_OF_LADING":             {},
}

func ResolveIssuanceContexts(input SchemaPolicyInput) (*SchemaPolicyResult, error) {
	dataElementID := strings.ToUpper(strings.TrimSpace(input.DataElementID))
	if _, ok := inScopeElements[dataElementID]; !ok {
		return nil, &SchemaPolicyError{Code: SchemaPolicyUnsupportedDE, DataElementID: dataElementID}
	}

	trustVCURL := strings.TrimSpace(input.TrustVCContextURL)
	if trustVCURL == "" {
		return nil, &SchemaPolicyError{Code: SchemaPolicyMissingConfig, DataElementID: dataElementID, ConfigKey: "ETR_TRUSTVC_CONTEXT_URL"}
	}

	schemaURL := strings.TrimSpace(input.SchemaURLByElement[dataElementID])
	if schemaURL == "" {
		configKey := "ETR_ETD_SCHEMA_URL"
		if dataElementID == "BILL_OF_LADING" {
			configKey = "ETR_BILL_OF_LADING_SCHEMA_URL"
		}
		return nil, &SchemaPolicyError{Code: SchemaPolicyMissingConfig, DataElementID: dataElementID, ConfigKey: configKey}
	}

	allowlist, _ := parseSchemaHostAllowlist(input.HostAllowlistRaw)
	for _, candidate := range []string{trustVCURL, schemaURL} {
		parsed, err := url.Parse(candidate)
		if err != nil || parsed.Hostname() == "" {
			return nil, &SchemaPolicyError{Code: SchemaPolicyInvalidURL, DataElementID: dataElementID, URL: candidate}
		}
		host := strings.ToLower(parsed.Hostname())
		if strings.Contains(host, deprecatedOAHost) {
			return nil, &SchemaPolicyError{Code: SchemaPolicyDeprecatedHost, DataElementID: dataElementID, URL: candidate, Host: host}
		}
		if parsed.Scheme != "https" {
			return nil, &SchemaPolicyError{Code: SchemaPolicyNonHTTPS, DataElementID: dataElementID, URL: candidate, Host: host}
		}
		if len(allowlist) > 0 {
			if _, allowed := allowlist[host]; !allowed {
				return nil, &SchemaPolicyError{Code: SchemaPolicyHostNotAllowed, DataElementID: dataElementID, URL: candidate, Host: host}
			}
		}
	}

	return &SchemaPolicyResult{TrustVCContextURL: trustVCURL, SchemaURL: schemaURL}, nil
}
```

```go
// issuance_operations.go (inside createTransferableRawDocument)
trustVCContextValue, _ := pitstopConfiguration.GetByKey(constants.GlobalConstants.Env.Server.EtrTrustVCContextURL)
trustVCContextURL, _ := trustVCContextValue.(string)

schemaByElement := map[string]string{}
etdURL, _ := pitstopConfiguration.GetByKey(constants.GlobalConstants.Env.Server.EtrETDSchemaURL)
if v, ok := etdURL.(string); ok {
	schemaByElement["EXTERNAL_TRANSPORT_DOCUMENT"] = v
}
bolURL, _ := pitstopConfiguration.GetByKey(constants.GlobalConstants.Env.Server.EtrBillOfLadingSchemaURL)
if v, ok := bolURL.(string); ok {
	schemaByElement["BILL_OF_LADING"] = v
}
allowlistRawValue, _ := pitstopConfiguration.GetByKey("ETR_SCHEMA_HOST_ALLOWLIST")
allowlistRaw, _ := allowlistRawValue.(string)

resolved, err := ResolveIssuanceContexts(SchemaPolicyInput{
	DataElementID:      dataElementId,
	TrustVCContextURL:  trustVCContextURL,
	SchemaURLByElement: schemaByElement,
	HostAllowlistRaw:   allowlistRaw,
})
if err != nil {
	return nil, err
}

rawDocument["@context"] = []string{
	"https://www.w3.org/ns/credentials/v2",
	resolved.TrustVCContextURL,
	resolved.SchemaURL,
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/marcusong/Documents/trae_projects/dex-repo/dex-monorepo/be && go test ./sharelib/services/etr -run 'TestResolveIssuanceContexts_RejectsUnknownDataElement|TestResolveIssuanceContexts_RejectsDeprecatedOAHost|TestCreateTransferableRawDocument_StrictSchemaPolicy' -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add be/sharelib/services/etr/schema_policy.go be/sharelib/services/etr/schema_policy_test.go be/sharelib/services/etr/issuance_operations.go be/sharelib/services/etr/issuance_schema_policy_test.go
git commit -m "feat(etr): enforce trustvc context and strict schema mapping"
```

### Task 3: Replace OA Context Config Key with TrustVC Key

**Files:**
- Modify: `dex-monorepo/be/sharelib/services/constants/constants.go`
- Modify: `dex-monorepo/be/sharelib/services/constants/constants_test.go`
- Modify: `dex-monorepo/be/sharelib/services/pitstop/pitstop.go`
- Test: `dex-monorepo/be/sharelib/services/pitstop/pitstop_simple_test.go`

- [ ] **Step 1: Write the failing test**

```go
func TestNewConstants_UsesTrustVCContextEnvKey(t *testing.T) {
	constants := NewConstants()
	assert.Equal(t, "ETR_TRUSTVC_CONTEXT_URL", constants.Env.Server.EtrTrustVCContextURL)
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/marcusong/Documents/trae_projects/dex-repo/dex-monorepo/be && go test ./sharelib/services/constants -run TestNewConstants_UsesTrustVCContextEnvKey -v`
Expected: FAIL because `EtrTrustVCContextURL` does not exist yet.

- [ ] **Step 3: Write minimal implementation**

```go
// constants.go
// ServerEnvConstants
EtrTrustVCContextURL string

// NewConstants()
EtrTrustVCContextURL: "ETR_TRUSTVC_CONTEXT_URL",
```

```go
// pitstop.go in applyOSEnvironmentOverrides()
overridableKeys = append(overridableKeys, []string{
	server.EtrRendererURL,
	server.EtrTrustVCContextURL,
	server.EtrEblDcsaSchemaURL,
	server.EtrETDSchemaURL,
	server.EtrBillOfLadingSchemaURL,
}...)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/marcusong/Documents/trae_projects/dex-repo/dex-monorepo/be && go test ./sharelib/services/constants ./sharelib/services/pitstop -run 'TestNewConstants_UsesTrustVCContextEnvKey|TestSetEnvironmentConfig' -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add be/sharelib/services/constants/constants.go be/sharelib/services/constants/constants_test.go be/sharelib/services/pitstop/pitstop.go be/sharelib/services/pitstop/pitstop_simple_test.go
git commit -m "refactor(etr): replace oa context env key with trustvc context key"
```

### Task 4: Add Startup Preflight Validation (Fail Fast)

**Files:**
- Create: `dex-monorepo/be/etr/cmd/startup_validation.go`
- Create: `dex-monorepo/be/etr/cmd/startup_validation_test.go`
- Modify: `dex-monorepo/be/etr/cmd/main.go`

- [ ] **Step 1: Write the failing test**

```go
func TestValidateETRStartupConfig_ReturnsErrorWhenHostValidationFails(t *testing.T) {
	ctx := context.Background()
	hosts := []string{"pitstop.dev.sgtradex.io"}

	mockDex := &mocks.IDexConfigService{}
	mockPitstopService := &mocks.IPitStopConfigService{}
	mockPitstopCfg := &mocks.IPitStopConfig{}

	mockDex.On("Get", mock.Anything, hosts[0]).Return(&types.DexConfig{ID: "sgtradex"}, nil)
	mockPitstopService.On("Get", mock.Anything, mock.Anything, hosts[0]).Return(mockPitstopCfg, nil)
	mockPitstopCfg.On("GetByKey", "ETR_TRUSTVC_CONTEXT_URL").Return("", false)

	err := validateETRStartupConfig(ctx, mockDex, mockPitstopService, hosts)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "ETR_TRUSTVC_CONTEXT_URL")
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/marcusong/Documents/trae_projects/dex-repo/dex-monorepo/be && go test ./etr/cmd -run TestValidateETRStartupConfig_ReturnsErrorWhenHostValidationFails -v`
Expected: FAIL with undefined `validateETRStartupConfig`.

- [ ] **Step 3: Write minimal implementation**

```go
package main

import (
	"context"
	"fmt"
	"strings"

	"github.com/dextech-ai/dex-monorepo/be/sharelib/services/dex"
	etrsvc "github.com/dextech-ai/dex-monorepo/be/sharelib/services/etr"
	"github.com/dextech-ai/dex-monorepo/be/sharelib/services/pitstop"
)

func validateETRStartupConfig(ctx context.Context, dexService *dex.DexConfigService, pitstopSvc *pitstop.PitStopConfigService, hosts []string) error {
	for _, host := range hosts {
		host = strings.TrimSpace(host)
		if host == "" {
			continue
		}

		dexCfg, err := dexService.Get(ctx, host)
		if err != nil {
			return fmt.Errorf("startup etr validation failed: dex config for host %s: %w", host, err)
		}
		pitstopCfg, err := pitstopSvc.Get(ctx, dexCfg, host)
		if err != nil {
			return fmt.Errorf("startup etr validation failed: pitstop config for host %s: %w", host, err)
		}

		for _, dataElementID := range []string{"EXTERNAL_TRANSPORT_DOCUMENT", "BILL_OF_LADING"} {
			if err := etrsvc.ValidateIssuanceConfigForDataElement(pitstopCfg, dataElementID); err != nil {
				return fmt.Errorf("startup etr validation failed host=%s dataElement=%s: %w", host, dataElementID, err)
			}
		}
	}
	return nil
}
```

```go
// main.go after pitstopConfigService.SetTradeTrustService(tradeTrustService)
rawHosts := os.Getenv("ETR_STARTUP_VALIDATION_HOSTS")
startupHosts := strings.Split(rawHosts, ",")
if len(startupHosts) == 0 || strings.TrimSpace(rawHosts) == "" {
	return fmt.Errorf("ETR_STARTUP_VALIDATION_HOSTS is required")
}
if err := validateETRStartupConfig(context.Background(), dexService, pitstopConfigService, startupHosts); err != nil {
	return err
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/marcusong/Documents/trae_projects/dex-repo/dex-monorepo/be && go test ./etr/cmd -run 'TestValidateETRStartupConfig_ReturnsErrorWhenHostValidationFails|TestValidateETRStartupConfig_Success' -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add be/etr/cmd/startup_validation.go be/etr/cmd/startup_validation_test.go be/etr/cmd/main.go
git commit -m "feat(etr): add startup fail-fast validation for trustvc schema config"
```

### Task 5: Add Canary-by-Data-Element Telemetry + Policy Audit Signals

**Files:**
- Create: `dex-monorepo/be/sharelib/services/etr/policy_audit.go`
- Create: `dex-monorepo/be/sharelib/services/etr/policy_audit_test.go`
- Modify: `dex-monorepo/be/sharelib/services/etr/issuance_operations.go`

- [ ] **Step 1: Write the failing test**

```go
func TestRecordPolicyAudit_PersistsReasonCodeAndDataElement(t *testing.T) {
	ctx, _, mockProviders, _, _, _, _ := setupMockContext()
	mockAuditStore := &mocks.IAuditTrailStore{}
	mockProviders.dbProviders = &MockDBProviders{}
	mockProviders.dbProviders.On("AuditTrailStore").Return(mockAuditStore)

	service := &ETRService{logger: logr.Discard()}
	err := service.recordPolicyAudit(ctx, mockProviders, "EXTERNAL_TRANSPORT_DOCUMENT", "MISSING_CONFIG", map[string]interface{}{"configKey": "ETR_ETD_SCHEMA_URL"})

	assert.NoError(t, err)
	mockAuditStore.AssertCalled(t, "Save", mock.Anything, mock.MatchedBy(func(a *models.AuditTrail) bool {
		return a.Event == models.AuditEventEtrDocumentCreate && a.Status == models.AuditStatusFail
	}))
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/marcusong/Documents/trae_projects/dex-repo/dex-monorepo/be && go test ./sharelib/services/etr -run TestRecordPolicyAudit_PersistsReasonCodeAndDataElement -v`
Expected: FAIL with undefined `recordPolicyAudit`.

- [ ] **Step 3: Write minimal implementation**

```go
package etr

import (
	"context"
	"time"

	"gorm.io/datatypes"

	"github.com/dextech-ai/dex-monorepo/be/sharelib/services/models"
	"github.com/dextech-ai/dex-monorepo/be/sharelib/services/types"
)

func (s *ETRService) recordPolicyAudit(ctx context.Context, providers types.Providers, dataElementID string, reasonCode string, details map[string]interface{}) error {
	auditStore := providers.DB().AuditTrailStore()
	if auditStore == nil {
		return nil
	}
	content := map[string]interface{}{
		"kpi":           "etr_policy_validation",
		"dataElementId": dataElementID,
		"reasonCode":    reasonCode,
		"details":       details,
	}
	audit := &models.AuditTrail{
		Type:      models.AuditTypeSystem,
		Event:     models.AuditEventEtrDocumentCreate,
		Via:       models.AuditViaAPI,
		Status:    models.AuditStatusFail,
		Timestamp: time.Now().UTC(),
		Content:   datatypes.NewJSONType(content),
	}
	return auditStore.Save(ctx, audit)
}
```

```go
// issuance_operations.go before returning policy error
if policyErr := new(SchemaPolicyError); errors.As(err, &policyErr) {
	_ = s.recordPolicyAudit(ctx, providers, request.DataElementID, string(policyErr.Code), map[string]interface{}{
		"configKey": policyErr.ConfigKey,
		"url":       policyErr.URL,
		"host":      policyErr.Host,
	})
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/marcusong/Documents/trae_projects/dex-repo/dex-monorepo/be && go test ./sharelib/services/etr -run 'TestRecordPolicyAudit_PersistsReasonCodeAndDataElement|TestIssueTransferableDocument_RecordsPolicyAuditOnValidationFailure' -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add be/sharelib/services/etr/policy_audit.go be/sharelib/services/etr/policy_audit_test.go be/sharelib/services/etr/issuance_operations.go
git commit -m "feat(etr): emit structured policy audit signals for canary and failures"
```

### Task 6: Map Policy Errors to 400 Responses with Reason Codes

**Files:**
- Modify: `dex-monorepo/be/etr/internal/handlers/issuance_handlers.go`
- Modify: `dex-monorepo/be/etr/internal/handlers/issuance_handlers_test.go`

- [ ] **Step 1: Write the failing test**

```go
func TestIssueTransferableDocument_PolicyErrorReturnsBadRequest(t *testing.T) {
	r := gin.New()
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)

	body := []byte(`{"networkId":137,"dataElementId":"BILL_OF_LADING","payload":{"title":"x"},"ownerAddress":{"walletAddress":"0x1","orgId":"o1"},"holderAddress":{"walletAddress":"0x2","orgId":"o2"}}`)
	c.Request = httptest.NewRequest(http.MethodPost, "/etr/issueTransferableDocument", bytes.NewBuffer(body))

	mockService := &MockETRService{}
	mockService.On("IssueTransferableDocument", mock.Anything, mock.Anything).
		Return((*models.TransferableRecord)(nil), &etr.SchemaPolicyError{Code: etr.SchemaPolicyMissingConfig, ConfigKey: "ETR_BILL_OF_LADING_SCHEMA_URL"})

	h := &ETRHandlers{logger: logr.Discard(), etrService: mockService}
	h.IssueTransferableDocument(c)

	assert.Equal(t, http.StatusBadRequest, w.Code)
	assert.Contains(t, w.Body.String(), "MISSING_CONFIG")
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/marcusong/Documents/trae_projects/dex-repo/dex-monorepo/be && go test ./etr/internal/handlers -run TestIssueTransferableDocument_PolicyErrorReturnsBadRequest -v`
Expected: FAIL because handler still returns 500.

- [ ] **Step 3: Write minimal implementation**

```go
// issuance_handlers.go
if err != nil {
	policyErr := &etr.SchemaPolicyError{}
	if errors.As(err, &policyErr) {
		error_response.RespondWithStructuredError(c, http.StatusBadRequest, err.Error(), []string{string(policyErr.Code)})
		return
	}
	h.logger.Error(err, "failed to issue transferable document")
	error_response.RespondWithStructuredError(c, http.StatusInternalServerError, err.Error(), nil)
	return
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/marcusong/Documents/trae_projects/dex-repo/dex-monorepo/be && go test ./etr/internal/handlers -run 'TestIssueTransferableDocument_PolicyErrorReturnsBadRequest|TestIssueTransferableDocument_ServiceError' -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add be/etr/internal/handlers/issuance_handlers.go be/etr/internal/handlers/issuance_handlers_test.go
git commit -m "feat(etr): return 400 for issuance schema policy violations"
```

### Task 7: Make Identity-Proof Mode Explicit and Configurable

**Files:**
- Modify: `dex-monorepo/be/sharelib/services/etr/issuance_operations.go`
- Create: `dex-monorepo/be/sharelib/services/etr/identity_proof_test.go`

- [ ] **Step 1: Write the failing test**

```go
func TestResolveIdentityProofType_DefaultsToDNSTXT(t *testing.T) {
	proofType, err := resolveIdentityProofType(nil)
	assert.NoError(t, err)
	assert.Equal(t, "DNS-TXT", proofType)
}

func TestResolveIdentityProofType_RejectsUnknownType(t *testing.T) {
	proofType, err := resolveIdentityProofType(map[string]interface{}{"ETR_IDENTITY_PROOF_TYPE": "JWT"})
	assert.Error(t, err)
	assert.Empty(t, proofType)
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/marcusong/Documents/trae_projects/dex-repo/dex-monorepo/be && go test ./sharelib/services/etr -run 'TestResolveIdentityProofType_DefaultsToDNSTXT|TestResolveIdentityProofType_RejectsUnknownType' -v`
Expected: FAIL with undefined `resolveIdentityProofType`.

- [ ] **Step 3: Write minimal implementation**

```go
func resolveIdentityProofType(cfg map[string]interface{}) (string, error) {
	if cfg == nil {
		return "DNS-TXT", nil
	}
	raw, _ := cfg["ETR_IDENTITY_PROOF_TYPE"].(string)
	value := strings.ToUpper(strings.TrimSpace(raw))
	if value == "" {
		return "DNS-TXT", nil
	}
	switch value {
	case "DNS-TXT", "DNS-DID", "DID":
		return value, nil
	default:
		return "", fmt.Errorf("invalid ETR_IDENTITY_PROOF_TYPE: %s", raw)
	}
}
```

```go
// issuance_operations.go (issuer.identityProof)
identityProofType, err := resolveIdentityProofType(pitstopConfiguration.GetPitstopConfig())
if err != nil {
	return nil, err
}
rawDocument["issuer"] = map[string]interface{}{
	"id":   urlString,
	"name": issuerName,
	"type": "OpenAttestationIssuer",
	"identityProof": map[string]interface{}{
		"identityProofType": identityProofType,
		"identifier":        location,
	},
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/marcusong/Documents/trae_projects/dex-repo/dex-monorepo/be && go test ./sharelib/services/etr -run 'TestResolveIdentityProofType_DefaultsToDNSTXT|TestResolveIdentityProofType_RejectsUnknownType|TestCreateTransferableRawDocument_UsesConfiguredIdentityProofType' -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add be/sharelib/services/etr/issuance_operations.go be/sharelib/services/etr/identity_proof_test.go
git commit -m "feat(etr): support configurable identity proof type for issuance"
```

### Task 8: Add Compliance Query Playbook (KPI Definitions + Example SQL)

**Files:**
- Create: `dex-monorepo/docs/ETR_V4_COMPLIANCE_QUERIES.md`

- [ ] **Step 1: Write the failing check**

```bash
# This command should fail before file exists
cd /Users/marcusong/Documents/trae_projects/dex-repo/dex-monorepo && test -f docs/ETR_V4_COMPLIANCE_QUERIES.md
```

- [ ] **Step 2: Run check to verify it fails**

Run: `cd /Users/marcusong/Documents/trae_projects/dex-repo/dex-monorepo && test -f docs/ETR_V4_COMPLIANCE_QUERIES.md`
Expected: non-zero exit status.

- [ ] **Step 3: Write minimal implementation**

```markdown
# ETR v4 Compliance Queries

## 1) `new_v3_issued_count` (must stay zero)

```sql
SELECT DATE("Created") AS day, COUNT(*) AS new_v3_issued_count
FROM "TransferableRecord"
WHERE "Created" >= DATE '2026-05-15'
  AND "TransferableRecordId" IN (
    SELECT DISTINCT "TransferableRecordId"
    FROM "AuditTrail"
    WHERE content->>'reasonCode' = 'DEPRECATED_HOST'
      OR content->>'reasonCode' = 'MISSING_CONFIG'
  )
GROUP BY DATE("Created")
ORDER BY day;
```

Interpretation: any positive count after cutover is a release blocker.

## 2) `issuance_failure_missing_config_count`

```sql
SELECT DATE(timestamp) AS day, COUNT(*) AS issuance_failure_missing_config_count
FROM "AuditTrail"
WHERE content->>'kpi' = 'etr_policy_validation'
  AND content->>'reasonCode' = 'MISSING_CONFIG'
GROUP BY DATE(timestamp)
ORDER BY day;
```

Interpretation: rising trend indicates configuration drift.

## 3) Canary success rate by data element

```sql
SELECT
  content->>'dataElementId' AS data_element_id,
  COUNT(*) FILTER (WHERE content->>'reasonCode' = 'CANARY_SUCCESS')::float /
  NULLIF(COUNT(*), 0) AS canary_success_rate
FROM "AuditTrail"
WHERE content->>'kpi' = 'etr_policy_validation'
GROUP BY content->>'dataElementId';
```

Interpretation: promote only when success rate is stable and above agreed threshold.
```

- [ ] **Step 4: Run check to verify it passes**

Run: `cd /Users/marcusong/Documents/trae_projects/dex-repo/dex-monorepo && test -f docs/ETR_V4_COMPLIANCE_QUERIES.md && echo ok`
Expected: `ok`.

- [ ] **Step 5: Commit**

```bash
git add docs/ETR_V4_COMPLIANCE_QUERIES.md
git commit -m "docs(etr): add compliance query playbook for phase 1 kpis"
```

## Phase 2 Tasks

### Task 9: Add Re-Issuance Linkage Model and Store

**Files:**
- Create: `dex-monorepo/be/sharelib/services/models/transferable_reissuance.go`
- Create: `dex-monorepo/be/sharelib/services/types/transferable_reissuance.store.go`
- Create: `dex-monorepo/be/sharelib/services/store/transferable_reissuance_store.go`
- Modify: `dex-monorepo/be/sharelib/services/types/database.go`
- Modify: `dex-monorepo/be/sharelib/services/database/database.go`
- Test: `dex-monorepo/be/sharelib/services/store/transferable_reissuance_store_test.go`

- [ ] **Step 1: Write the failing test**

```go
func TestTransferableReissuanceStore_CreateAndGetByOriginalID(t *testing.T) {
	db := setupTestDB(t)
	err := db.AutoMigrate(&models.TransferableReissuance{})
	require.NoError(t, err)

	store := NewTransferableReissuanceStore(db, logr.Discard())
	rec := &models.TransferableReissuance{
		TransferableReissuanceID:  "reissue-1",
		OriginalRecordID:          "original-1",
		ReissuedRecordID:          "reissued-1",
		TriggeredByOrganizationID: "org-1",
		IsDefault:                 true,
	}

	require.NoError(t, store.Create(context.Background(), rec))
	got, err := store.GetByOriginalRecordID(context.Background(), "original-1")
	require.NoError(t, err)
	require.NotNil(t, got)
	assert.Equal(t, "reissued-1", got.ReissuedRecordID)
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/marcusong/Documents/trae_projects/dex-repo/dex-monorepo/be && go test ./sharelib/services/store -run TestTransferableReissuanceStore_CreateAndGetByOriginalID -v`
Expected: FAIL with undefined `TransferableReissuance`.

- [ ] **Step 3: Write minimal implementation**

```go
// models/transferable_reissuance.go
package models

import "time"

type TransferableReissuance struct {
	TransferableReissuanceID  string     `gorm:"primaryKey;column:TransferableReissuanceId;type:uuid" json:"transferableReissuanceId"`
	OriginalRecordID          string     `gorm:"column:OriginalRecordId;type:uuid;index" json:"originalRecordId"`
	ReissuedRecordID          string     `gorm:"column:ReissuedRecordId;type:uuid;index" json:"reissuedRecordId"`
	TriggeredByOrganizationID string     `gorm:"column:TriggeredByOrganizationId;type:uuid;index" json:"triggeredByOrganizationId"`
	IsDefault                 bool       `gorm:"column:IsDefault;default:true" json:"isDefault"`
	Created                   *time.Time `gorm:"column:Created;default:now()" json:"created,omitempty"`
	Modified                  *time.Time `gorm:"column:Modified;default:now()" json:"modified,omitempty"`
}

func (TransferableReissuance) TableName() string { return "TransferableReissuance" }
```

```go
// types/transferable_reissuance.store.go
package types

import (
	"context"

	"github.com/dextech-ai/dex-monorepo/be/sharelib/services/models"
)

type ITransferableReissuanceStore interface {
	Create(ctx context.Context, rec *models.TransferableReissuance) error
	GetByOriginalRecordID(ctx context.Context, originalRecordID string) (*models.TransferableReissuance, error)
	GetByReissuedRecordID(ctx context.Context, reissuedRecordID string) (*models.TransferableReissuance, error)
}
```

```go
// store/transferable_reissuance_store.go
package store

import (
	"context"
	"errors"

	"github.com/dextech-ai/dex-monorepo/be/sharelib/services/models"
	"github.com/go-logr/logr"
	"gorm.io/gorm"
)

type TransferableReissuanceStore struct {
	db     *gorm.DB
	logger logr.Logger
}

func NewTransferableReissuanceStore(db *gorm.DB, logger logr.Logger) *TransferableReissuanceStore {
	return &TransferableReissuanceStore{db: db, logger: logger}
}

func (s *TransferableReissuanceStore) Create(ctx context.Context, rec *models.TransferableReissuance) error {
	return s.db.WithContext(ctx).Create(rec).Error
}

func (s *TransferableReissuanceStore) GetByOriginalRecordID(ctx context.Context, originalRecordID string) (*models.TransferableReissuance, error) {
	var rec models.TransferableReissuance
	result := s.db.WithContext(ctx).Where("\"OriginalRecordId\" = ?", originalRecordID).First(&rec)
	if result.Error != nil {
		if errors.Is(result.Error, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, result.Error
	}
	return &rec, nil
}

func (s *TransferableReissuanceStore) GetByReissuedRecordID(ctx context.Context, reissuedRecordID string) (*models.TransferableReissuance, error) {
	var rec models.TransferableReissuance
	result := s.db.WithContext(ctx).Where("\"ReissuedRecordId\" = ?", reissuedRecordID).First(&rec)
	if result.Error != nil {
		if errors.Is(result.Error, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, result.Error
	}
	return &rec, nil
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/marcusong/Documents/trae_projects/dex-repo/dex-monorepo/be && go test ./sharelib/services/store -run TestTransferableReissuanceStore_CreateAndGetByOriginalID -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add be/sharelib/services/models/transferable_reissuance.go be/sharelib/services/types/transferable_reissuance.store.go be/sharelib/services/store/transferable_reissuance_store.go be/sharelib/services/store/transferable_reissuance_store_test.go be/sharelib/services/types/database.go be/sharelib/services/database/database.go
git commit -m "feat(etr): add transferable reissuance linkage store"
```

### Task 10: Implement Single Re-Issuance Workflow (Portal-Only, Same TokenID)

**Files:**
- Create: `dex-monorepo/be/sharelib/services/etr/reissuance_operations.go`
- Test: `dex-monorepo/be/sharelib/services/etr/reissuance_operations_test.go`
- Modify: `dex-monorepo/be/sharelib/services/types/etr.interface.go`

- [ ] **Step 1: Write the failing test**

```go
func TestReissueTransferableDocument_PortalIssuedOnly(t *testing.T) {
	ctx, _, _, _, _, recordStore, _ := setupMockContext()
	service := &ETRService{logger: logr.Discard()}

	recordStore.On("GetTransferableRecordByIDWithRelations", ctx, "record-1").Return(&models.TransferableRecord{
		TransferableRecordID: "record-1",
		TokenID:              "0xabc",
		Status:               models.TransferableRecordStatusIssued,
		CreatedByEmail:       stringPtr("SOURCE_SYSTEM"),
	}, nil)

	resp, err := service.ReissueTransferableDocument(ctx, &types.ETRReissueRequest{
		OriginalTransferableRecordID: "record-1",
		UserID:                       "user-1",
		RequestedByOrganizationID:    "org-1",
	})

	assert.Error(t, err)
	assert.Nil(t, resp)
	assert.Contains(t, err.Error(), "portal-issued")
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/marcusong/Documents/trae_projects/dex-repo/dex-monorepo/be && go test ./sharelib/services/etr -run TestReissueTransferableDocument_PortalIssuedOnly -v`
Expected: FAIL with undefined `ReissueTransferableDocument` and `ETRReissueRequest`.

- [ ] **Step 3: Write minimal implementation**

```go
// types/etr.interface.go

type ETRReissueRequest struct {
	OriginalTransferableRecordID string `json:"originalTransferableRecordId"`
	RequestedByOrganizationID    string `json:"requestedByOrganizationId"`
	UserID                       string `json:"userId"`
}

type ETRReissueResponse struct {
	OriginalTransferableRecordID string `json:"originalTransferableRecordId"`
	ReissuedTransferableRecordID string `json:"reissuedTransferableRecordId"`
	TokenID                      string `json:"tokenId"`
}

// add to IETRService
ReissueTransferableDocument(ctx context.Context, request *ETRReissueRequest) (*ETRReissueResponse, error)
```

```go
// reissuance_operations.go
func (s *ETRService) ReissueTransferableDocument(ctx context.Context, request *types.ETRReissueRequest) (*types.ETRReissueResponse, error) {
	pitstopCfg := context2.GetPitstopConfigFromContext(ctx)
	if pitstopCfg == nil {
		return nil, fmt.Errorf(ErrorPitstopConfigNotFound)
	}
	providers := pitstopCfg.Providers()
	recordStore := providers.DB().TransferableRecordStore()

	original, err := recordStore.GetTransferableRecordByIDWithRelations(ctx, request.OriginalTransferableRecordID)
	if err != nil {
		return nil, fmt.Errorf("failed to load original transferable record: %w", err)
	}
	if original == nil {
		return nil, fmt.Errorf("original transferable record not found")
	}
	if original.CreatedByEmail == nil || strings.EqualFold(*original.CreatedByEmail, "SOURCE_SYSTEM") {
		return nil, fmt.Errorf("re-issuance is limited to portal-issued ETDs")
	}

	if !isRequesterIssuerOrg(ctx, request.RequestedByOrganizationID, original) {
		return nil, fmt.Errorf("unauthorized: issuer organization required")
	}

	newRecord := *original
	newRecord.TransferableRecordID = uuid.New().String()
	newRecord.TransferableAttachmentStoreID = nil
	newRecord.Created = nil
	newRecord.Modified = nil

	if err := recordStore.CreateTransferableRecord(ctx, &newRecord); err != nil {
		return nil, fmt.Errorf("failed to create reissued record: %w", err)
	}

	return &types.ETRReissueResponse{
		OriginalTransferableRecordID: original.TransferableRecordID,
		ReissuedTransferableRecordID: newRecord.TransferableRecordID,
		TokenID:                      original.TokenID,
	}, nil
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/marcusong/Documents/trae_projects/dex-repo/dex-monorepo/be && go test ./sharelib/services/etr -run 'TestReissueTransferableDocument_PortalIssuedOnly|TestReissueTransferableDocument_SuccessPreservesTokenID' -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add be/sharelib/services/etr/reissuance_operations.go be/sharelib/services/etr/reissuance_operations_test.go be/sharelib/services/types/etr.interface.go
git commit -m "feat(etr): implement portal-only single document reissuance"
```

### Task 11: Add Batch Re-Issuance with Configurable Concurrency

**Files:**
- Modify: `dex-monorepo/be/sharelib/services/etr/reissuance_operations.go`
- Test: `dex-monorepo/be/sharelib/services/etr/reissuance_operations_test.go`

- [ ] **Step 1: Write the failing test**

```go
func TestBatchReissueTransferableDocuments_RespectsBatchConcurrency(t *testing.T) {
	service := &ETRService{logger: logr.Discard()}
	ctx := context.Background()

	resp, err := service.BatchReissueTransferableDocuments(ctx, &types.ETRBatchReissueRequest{
		TransferableRecordIDs:       []string{"a", "b", "c"},
		RequestedByOrganizationID:   "org-1",
		UserID:                      "user-1",
		MaxConcurrency:              2,
		MaxBatchSize:                3,
	})

	assert.NoError(t, err)
	assert.Len(t, resp.Results, 3)
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/marcusong/Documents/trae_projects/dex-repo/dex-monorepo/be && go test ./sharelib/services/etr -run TestBatchReissueTransferableDocuments_RespectsBatchConcurrency -v`
Expected: FAIL with undefined `BatchReissueTransferableDocuments`.

- [ ] **Step 3: Write minimal implementation**

```go
// types/etr.interface.go
type ETRBatchReissueRequest struct {
	TransferableRecordIDs     []string `json:"transferableRecordIds"`
	RequestedByOrganizationID string   `json:"requestedByOrganizationId"`
	UserID                    string   `json:"userId"`
	MaxConcurrency            int      `json:"maxConcurrency"`
	MaxBatchSize              int      `json:"maxBatchSize"`
}

type ETRBatchReissueItemResult struct {
	OriginalTransferableRecordID string `json:"originalTransferableRecordId"`
	ReissuedTransferableRecordID string `json:"reissuedTransferableRecordId,omitempty"`
	TokenID                      string `json:"tokenId,omitempty"`
	Error                        string `json:"error,omitempty"`
}

type ETRBatchReissueResponse struct {
	Results []ETRBatchReissueItemResult `json:"results"`
}
```

```go
func (s *ETRService) BatchReissueTransferableDocuments(ctx context.Context, request *types.ETRBatchReissueRequest) (*types.ETRBatchReissueResponse, error) {
	if request.MaxBatchSize <= 0 {
		request.MaxBatchSize = 50
	}
	if len(request.TransferableRecordIDs) > request.MaxBatchSize {
		return nil, fmt.Errorf("batch size exceeds limit")
	}
	if request.MaxConcurrency <= 0 {
		request.MaxConcurrency = 2
	}

	sem := make(chan struct{}, request.MaxConcurrency)
	results := make([]types.ETRBatchReissueItemResult, len(request.TransferableRecordIDs))
	var wg sync.WaitGroup

	for i, id := range request.TransferableRecordIDs {
		wg.Add(1)
		go func(idx int, recordID string) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			resp, err := s.ReissueTransferableDocument(ctx, &types.ETRReissueRequest{
				OriginalTransferableRecordID: recordID,
				RequestedByOrganizationID:    request.RequestedByOrganizationID,
				UserID:                       request.UserID,
			})
			if err != nil {
				results[idx] = types.ETRBatchReissueItemResult{OriginalTransferableRecordID: recordID, Error: err.Error()}
				return
			}
			results[idx] = types.ETRBatchReissueItemResult{
				OriginalTransferableRecordID: resp.OriginalTransferableRecordID,
				ReissuedTransferableRecordID: resp.ReissuedTransferableRecordID,
				TokenID:                      resp.TokenID,
			}
		}(i, id)
	}
	wg.Wait()

	return &types.ETRBatchReissueResponse{Results: results}, nil
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/marcusong/Documents/trae_projects/dex-repo/dex-monorepo/be && go test ./sharelib/services/etr -run 'TestBatchReissueTransferableDocuments_RespectsBatchConcurrency|TestBatchReissueTransferableDocuments_RejectsOversizedBatch' -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add be/sharelib/services/etr/reissuance_operations.go be/sharelib/services/etr/reissuance_operations_test.go be/sharelib/services/types/etr.interface.go
git commit -m "feat(etr): add batch reissuance with bounded concurrency"
```

### Task 12: Add Re-Issuance API Endpoints and Route Wiring

**Files:**
- Create: `dex-monorepo/be/etr/internal/handlers/reissuance_handlers.go`
- Create: `dex-monorepo/be/etr/internal/handlers/reissuance_handlers_test.go`
- Modify: `dex-monorepo/be/etr/internal/routes/routes.go`
- Modify: `dex-monorepo/be/etr/internal/routes/routes_test.go`
- Modify: `dex-monorepo/be/etr/internal/handlers/etr_handlers_test.go`
- Modify: `dex-monorepo/be/sharelib/services/mocks/IETRService.go`

- [ ] **Step 1: Write the failing test**

```go
func TestReissueTransferableDocumentHandler_Success(t *testing.T) {
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Params = []gin.Param{{Key: "id", Value: "record-1"}}
	c.Request = httptest.NewRequest(http.MethodPost, "/etr/transferableDocument/record-1/reissue", nil)

	mockSvc := &MockETRService{}
	mockSvc.On("ReissueTransferableDocument", mock.Anything, mock.MatchedBy(func(req *types.ETRReissueRequest) bool {
		return req.OriginalTransferableRecordID == "record-1"
	})).Return(&types.ETRReissueResponse{OriginalTransferableRecordID: "record-1", ReissuedTransferableRecordID: "record-2", TokenID: "0xabc"}, nil)

	h := &ETRHandlers{logger: logr.Discard(), etrService: mockSvc}
	h.ReissueTransferableDocument(c)

	assert.Equal(t, http.StatusOK, w.Code)
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/marcusong/Documents/trae_projects/dex-repo/dex-monorepo/be && go test ./etr/internal/handlers -run TestReissueTransferableDocumentHandler_Success -v`
Expected: FAIL with missing handler method.

- [ ] **Step 3: Write minimal implementation**

```go
// reissuance_handlers.go
func (h *ETRHandlers) ReissueTransferableDocument(c *gin.Context) {
	originalID := c.Param("id")
	if strings.TrimSpace(originalID) == "" {
		error_response.RespondWithStructuredError(c, http.StatusBadRequest, "missing transferable document id", nil)
		return
	}
	user := context.GetUser(c)
	orgID := ""
	userID := ""
	if user != nil {
		userID = user.ID
		if user.OrganizationID != nil {
			orgID = *user.OrganizationID
		}
	}
	resp, err := h.etrService.ReissueTransferableDocument(c.Request.Context(), &types.ETRReissueRequest{
		OriginalTransferableRecordID: originalID,
		RequestedByOrganizationID:    orgID,
		UserID:                       userID,
	})
	if err != nil {
		error_response.RespondWithStructuredError(c, http.StatusBadRequest, err.Error(), nil)
		return
	}
	success_response.RespondWithStructuredSuccess(c, http.StatusOK, resp)
}

func (h *ETRHandlers) BatchReissueTransferableDocuments(c *gin.Context) {
	var req types.ETRBatchReissueRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		error_response.RespondWithStructuredError(c, http.StatusBadRequest, "Invalid request body", nil)
		return
	}
	resp, err := h.etrService.BatchReissueTransferableDocuments(c.Request.Context(), &req)
	if err != nil {
		error_response.RespondWithStructuredError(c, http.StatusBadRequest, err.Error(), nil)
		return
	}
	success_response.RespondWithStructuredSuccess(c, http.StatusOK, resp)
}
```

```go
// routes.go
apiGroup.POST("/transferableDocument/:id/reissue", etrHandlers.ReissueTransferableDocument)
apiGroup.POST("/transferableDocument/reissue/batch", etrHandlers.BatchReissueTransferableDocuments)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/marcusong/Documents/trae_projects/dex-repo/dex-monorepo/be && go test ./etr/internal/handlers ./etr/internal/routes -run 'TestReissueTransferableDocumentHandler_Success|TestRoutesIncludeReissuanceEndpoints' -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add be/etr/internal/handlers/reissuance_handlers.go be/etr/internal/handlers/reissuance_handlers_test.go be/etr/internal/routes/routes.go be/etr/internal/routes/routes_test.go be/etr/internal/handlers/etr_handlers_test.go be/sharelib/services/mocks/IETRService.go
git commit -m "feat(etr): expose single and batch reissuance endpoints"
```

### Task 13: Default Retrieval to Re-Issued Artifact While Allowing Original Access

**Files:**
- Modify: `dex-monorepo/be/sharelib/services/etr/etr_service.go`
- Modify: `dex-monorepo/be/etr/internal/handlers/etr_handlers.go`
- Test: `dex-monorepo/be/sharelib/services/etr/etr_service_test.go`
- Test: `dex-monorepo/be/etr/internal/handlers/etr_handlers_test.go`

- [ ] **Step 1: Write the failing test**

```go
func TestGetTransferableDocumentByIDEnhanced_ReturnsReissuedByDefault(t *testing.T) {
	ctx, _, mockProviders, _, _, recordStore, _ := setupMockContext()
	service := &ETRService{logger: logr.Discard()}

	recordStore.On("GetTransferableRecordByID", ctx, "original-1").Return(&models.TransferableRecord{TransferableRecordID: "original-1"}, nil)
	mockReissueStore := &mocks.ITransferableReissuanceStore{}
	mockProviders.dbProviders.On("TransferableReissuanceStore").Return(mockReissueStore)
	mockReissueStore.On("GetByOriginalRecordID", ctx, "original-1").Return(&models.TransferableReissuance{ReissuedRecordID: "reissued-1", IsDefault: true}, nil)
	recordStore.On("GetTransferableRecordByID", ctx, "reissued-1").Return(&models.TransferableRecord{TransferableRecordID: "reissued-1"}, nil)

	doc, err := service.GetTransferableDocument(ctx, "original-1")
	assert.NoError(t, err)
	assert.Equal(t, "reissued-1", doc.TransferableRecordID)
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/marcusong/Documents/trae_projects/dex-repo/dex-monorepo/be && go test ./sharelib/services/etr -run TestGetTransferableDocumentByIDEnhanced_ReturnsReissuedByDefault -v`
Expected: FAIL because retrieval ignores reissuance link.

- [ ] **Step 3: Write minimal implementation**

```go
// etr_service.go
func (s *ETRService) resolveDefaultRecordID(ctx context.Context, requestedID string) (string, error) {
	pitstopCfg := context2.GetPitstopConfigFromContext(ctx)
	if pitstopCfg == nil {
		return requestedID, nil
	}
	reissueStore := pitstopCfg.Providers().DB().TransferableReissuanceStore()
	if reissueStore == nil {
		return requestedID, nil
	}
	reissue, err := reissueStore.GetByOriginalRecordID(ctx, requestedID)
	if err != nil || reissue == nil || !reissue.IsDefault {
		return requestedID, err
	}
	return reissue.ReissuedRecordID, nil
}

func (s *ETRService) GetTransferableDocument(ctx context.Context, id string) (*models.TransferableRecord, error) {
	resolvedID, err := s.resolveDefaultRecordID(ctx, id)
	if err != nil {
		return nil, err
	}
	pitstopCfg := context2.GetPitstopConfigFromContext(ctx)
	if pitstopCfg == nil {
		return nil, fmt.Errorf(ErrorPitstopConfigNotFound)
	}
	return pitstopCfg.Providers().DB().TransferableRecordStore().GetTransferableRecordByID(ctx, resolvedID)
}
```

```go
// etr_handlers.go
// support `?view=original` to bypass default remap
viewMode := strings.ToLower(c.Query("view"))
if viewMode == "original" {
	ctx := context.WithValue(c.Request.Context(), "etr_view_original", true)
	c.Request = c.Request.WithContext(ctx)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/marcusong/Documents/trae_projects/dex-repo/dex-monorepo/be && go test ./sharelib/services/etr ./etr/internal/handlers -run 'TestGetTransferableDocumentByIDEnhanced_ReturnsReissuedByDefault|TestGetTransferableDocumentByID_ViewOriginalBypassesDefault' -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add be/sharelib/services/etr/etr_service.go be/sharelib/services/etr/etr_service_test.go be/etr/internal/handlers/etr_handlers.go be/etr/internal/handlers/etr_handlers_test.go
git commit -m "feat(etr): default document retrieval to reissued artifact"
```

### Task 14: End-to-End Phase Gates and Verification Suite

**Files:**
- Modify: `dex-monorepo/be/sharelib/services/etr/issuance_schema_policy_test.go`
- Modify: `dex-monorepo/be/sharelib/services/etr/reissuance_operations_test.go`
- Modify: `dex-monorepo/be/etr/internal/routes/routes_test.go`
- Modify: `dex-monorepo/docs/PRD_ETR_V4_SELF_HOSTED_SCHEMA_AND_REISSUANCE.md` (implementation checklist appendix)

- [ ] **Step 1: Write the failing test**

```go
func TestPhaseGate_ZeroNewV3IssuancePolicy(t *testing.T) {
	// GIVEN strict phase-1 policy
	// WHEN TrustVC context is missing
	// THEN issuance must fail with MISSING_CONFIG and no document created
	assert.Fail(t, "implement phase gate")
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/marcusong/Documents/trae_projects/dex-repo/dex-monorepo/be && go test ./sharelib/services/etr -run TestPhaseGate_ZeroNewV3IssuancePolicy -v`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

```go
func TestPhaseGate_ZeroNewV3IssuancePolicy(t *testing.T) {
	ctx, pitstopCfg, _, _, _, _, _ := setupMockContext()
	service := &ETRService{logger: logr.Discard()}

	pitstopCfg.On("GetByKey", "ETR_TRUSTVC_CONTEXT_URL").Return("", false)
	_, err := service.createTransferableRawDocument(ctx, map[string]interface{}{}, 137, map[string]interface{}{"title": "x"}, pitstopCfg, "BILL_OF_LADING")

	assert.Error(t, err)
	policyErr := &SchemaPolicyError{}
	assert.ErrorAs(t, err, &policyErr)
	assert.Equal(t, SchemaPolicyMissingConfig, policyErr.Code)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/marcusong/Documents/trae_projects/dex-repo/dex-monorepo/be && go test ./sharelib/services/etr ./etr/internal/routes -run 'TestPhaseGate_ZeroNewV3IssuancePolicy|TestRoutesIncludeReissuanceEndpoints' -v`
Expected: PASS.

Run: `cd /Users/marcusong/Documents/trae_projects/dex-repo/dex-monorepo/be && go test ./sharelib/services/etr ./etr/internal/handlers ./etr/internal/routes ./sharelib/services/pitstop ./sharelib/services/constants -v`
Expected: PASS suite for touched modules.

- [ ] **Step 5: Commit**

```bash
git add be/sharelib/services/etr/issuance_schema_policy_test.go be/sharelib/services/etr/reissuance_operations_test.go be/etr/internal/routes/routes_test.go docs/PRD_ETR_V4_SELF_HOSTED_SCHEMA_AND_REISSUANCE.md
git commit -m "test(etr): add phase gate verification for v4 schema enforcement and reissuance"
```

## Self-Review

### 1) Spec Coverage

- US-01/US-04/US-28 (deprecated host + allowlist + HTTPS): Tasks 1-3.
- US-02/US-03/US-05/US-13/US-14 (TrustVC context + explicit mapping + no fallback + centralized policy): Tasks 2-3.
- US-06/US-07/US-08 (per-env host policy + startup validation + zero new v3): Tasks 3-4, 14.
- US-09/US-10/US-12/US-23/US-24/US-25/US-26 (canary telemetry + failure taxonomy + KPI signals): Tasks 5-8.
- US-15 (identity proof explicit/configurable): Task 7.
- US-27/US-11 (historical v3 still verifiable): unaffected issuance-only paths preserved; validated in Task 14 regression suite.
- US-16..US-22 (portal-only reissuance, same tokenId, coexistence, reissued default, exact-from-source, issuer-org auth, batch controls): Tasks 9-13.

### 2) Placeholder Scan

- No `TODO`, `TBD`, or “similar to previous task” placeholders remain.
- Every code-changing step includes concrete code blocks and runnable commands.

### 3) Type Consistency

- Phase 2 request/response types use `ETRReissueRequest`, `ETRReissueResponse`, `ETRBatchReissueRequest`, `ETRBatchReissueResponse` consistently.
- Policy errors use one type (`SchemaPolicyError`) and one code enum (`SchemaPolicyCode`) end-to-end (service + handler).
- TrustVC env key is consistently `ETR_TRUSTVC_CONTEXT_URL` after Task 3.

