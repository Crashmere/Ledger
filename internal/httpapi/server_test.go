package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/http/httputil"
	"net/url"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"

	"ledger/internal/ledger"
)

func TestHTTPFormsErrorsAndPageFallback(t *testing.T) {
	store, err := ledger.Open(filepath.Join(t.TempDir(), "ledger.sqlite"), true)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	handler := New(store, fstest.MapFS{"index.html": {Data: []byte("<html>ledger</html>")}, "assets/app.js": {Data: []byte("app")}})
	send := func(method, path, body, origin string) *httptest.ResponseRecorder {
		t.Helper()
		request := httptest.NewRequest(method, path, strings.NewReader(body))
		request.Header.Set("Content-Type", "application/json")
		if origin != "" {
			request.Header.Set("Origin", origin)
		}
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		return response
	}
	for _, body := range []string{"null", "[]", "{}", `{"name":"现金","color":null}`} {
		if response := send("POST", "/api/accounts", body, ""); response.Code != 400 {
			t.Fatalf("accepted invalid form %s: %d", body, response.Code)
		}
	}
	input := `{"name":"现金","color":-1,"initialBalance":10000,"includeInBalance":true,"kind":"normal","periodStart":null,"periodEnd":null,"archived":false}`
	response := send("POST", "/api/accounts", input, "")
	if response.Code != 200 {
		t.Fatal(response.Body.String())
	}
	var account ledger.Account
	if err = json.Unmarshal(response.Body.Bytes(), &account); err != nil {
		t.Fatal(err)
	}
	if response = send("PUT", "/api/accounts/"+account.ID, `{"name":"不能覆盖","color":1,"kind":"normal"}`, ""); response.Code != 400 {
		t.Fatal("partial form accepted")
	}
	accounts, _ := store.Accounts(context.Background())
	if accounts.Items[0].InitialBalance != 10000 || accounts.Items[0].Name != "现金" {
		t.Fatal("partial update changed account")
	}
	if response = send("POST", "/api/accounts", input, "http://other.example"); response.Code != 403 {
		t.Fatal("cross-origin accepted")
	}
	if response = send("POST", "/api/transactions/query", `{"filter":{},"pageSize":201}`, ""); response.Code != 400 {
		t.Fatal("page size limit missing")
	}
	if response = send("GET", "/api/no-such-api", "", ""); response.Code != 404 || !strings.Contains(response.Header().Get("Content-Type"), "application/json") {
		t.Fatal("API fell back to HTML")
	}
	if response = send("GET", "/txn/example/edit", "", ""); response.Code != 200 || !strings.Contains(response.Body.String(), "<html>") {
		t.Fatal("SPA deep link failed")
	}
	if response = send("GET", "/assets/missing.js", "", ""); response.Code != 404 {
		t.Fatal("missing asset fell back to HTML")
	}
	if response = send("GET", "/api/accounts", "", ""); response.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("API cache allowed")
	}
	if response = send(http.MethodHead, "/search", "", ""); response.Body.Len() != 0 {
		t.Fatal("HEAD returned a body")
	}
}

func TestTransactionsWithoutTags(t *testing.T) {
	store, err := ledger.Open(filepath.Join(t.TempDir(), "ledger.sqlite"), true)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	account, err := store.SaveAccount(context.Background(), "", ledger.AccountInput{Name: "合成账户", Color: -1, Kind: "normal", IncludeInBalance: true})
	if err != nil {
		t.Fatal(err)
	}
	handler := New(store, nil)
	send := func(method, path, body string, status int) *httptest.ResponseRecorder {
		t.Helper()
		request := httptest.NewRequest(method, path, strings.NewReader(body))
		request.Header.Set("Content-Type", "application/json")
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != status {
			t.Fatalf("%s %s: %d %s", method, path, response.Code, response.Body.String())
		}
		return response
	}
	for _, route := range []struct{ method, path string }{{"GET", "/api/tags"}, {"POST", "/api/tags"}, {"PUT", "/api/tags/old"}, {"DELETE", "/api/tags/old"}} {
		send(route.method, route.path, `{"name":"旧标签","color":-1}`, 404)
	}
	input := fmt.Sprintf(`{"type":"expense","amount":1234,"accountId":%q,"toAccountId":null,"categoryId":null,"date":"2026-09-01","title":"午餐","note":null}`, account.ID)
	response := send("POST", "/api/transactions", input, 200)
	var transaction ledger.Transaction
	if err = json.Unmarshal(response.Body.Bytes(), &transaction); err != nil {
		t.Fatal(err)
	}
	send("PUT", "/api/transactions/"+transaction.ID, strings.Replace(input, "1234", "1500", 1), 200)
	for _, response := range []*httptest.ResponseRecorder{
		response,
		send("GET", "/api/transactions/"+transaction.ID, "", 200),
		send("POST", "/api/transactions/query", `{"filter":{"keyword":"午餐","searchFields":["title","note","category"]}}`, 200),
	} {
		if strings.Contains(response.Body.String(), `"tags"`) {
			t.Fatal("obsolete tags response field")
		}
	}
	obsolete := strings.TrimSuffix(input, "}") + `,"tagIds":[]}`
	send("POST", "/api/transactions", obsolete, 400)
	send("PUT", "/api/transactions/"+transaction.ID, obsolete, 400)
	for _, path := range []string{"/api/transactions/query", "/api/statistics/summary", "/api/statistics/categories", "/api/statistics/daily"} {
		send("POST", path, `{"filter":{"tagIds":["old"]}}`, 400)
		send("POST", path, `{"filter":{"keyword":"午餐","searchFields":["tag"],"dateFrom":"2026-09-01","dateTo":"2026-09-02"}}`, 400)
	}
	summary, err := store.Summary(context.Background(), ledger.SummaryQuery{})
	if err != nil || summary.TotalCount != 1 || summary.Expense != 1500 {
		t.Fatalf("rejected writes changed ledger: %+v %v", summary, err)
	}
}

// 模拟 Nginx 去掉 /ledger 前缀并保留浏览器 Host，验证同源读写和深链接。
func TestPathPrefixThroughReverseProxy(t *testing.T) {
	store, err := ledger.Open(filepath.Join(t.TempDir(), "ledger.sqlite"), true)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	backend := httptest.NewServer(New(store, fstest.MapFS{
		"index.html":           {Data: []byte("<html>ledger</html>")},
		"assets/app.js":        {Data: []byte("app")},
		"manifest.webmanifest": {Data: []byte(`{"scope":"./","start_url":"./","display":"standalone"}`)},
	}))
	defer backend.Close()
	target, err := url.Parse(backend.URL)
	if err != nil {
		t.Fatal(err)
	}
	proxy := httputil.NewSingleHostReverseProxy(target)
	mux := http.NewServeMux()
	mux.Handle("/ledger/", http.StripPrefix("/ledger", proxy))
	send := func(method, path, body, origin string) *httptest.ResponseRecorder {
		t.Helper()
		request := httptest.NewRequest(method, "http://ledger.example"+path, strings.NewReader(body))
		request.Header.Set("Content-Type", "application/json")
		request.Header.Set("Origin", origin)
		response := httptest.NewRecorder()
		mux.ServeHTTP(response, request)
		return response
	}
	for _, path := range []string{"/ledger/", "/ledger/search", "/ledger/txn/example/edit", "/ledger/assets/app.js", "/ledger/manifest.webmanifest", "/ledger/healthz"} {
		if response := send("GET", path, "", ""); response.Code != 200 {
			t.Fatalf("%s: %d", path, response.Code)
		}
	}
	manifest := send("GET", "/ledger/manifest.webmanifest", "", "")
	if !strings.Contains(manifest.Header().Get("Content-Type"), "application/manifest+json") || !json.Valid(manifest.Body.Bytes()) {
		t.Fatalf("manifest must be served as JSON, not SPA HTML: %s", manifest.Body.String())
	}
	if manifest.Header().Get("Cache-Control") != "no-cache" {
		t.Fatal("manifest must be revalidated when updating desktop entry metadata")
	}
	input := `{"name":"合成代理测试","color":-1,"initialBalance":0,"includeInBalance":true,"kind":"normal","periodStart":null,"periodEnd":null,"archived":false}`
	if response := send("POST", "/ledger/api/accounts", input, "http://ledger.example"); response.Code != 200 {
		t.Fatalf("same-origin write: %d %s", response.Code, response.Body.String())
	}
	if response := send("POST", "/ledger/api/accounts", input, "http://other.example"); response.Code != 403 {
		t.Fatal("cross-origin write accepted through proxy")
	}
	if response := send("GET", "/ledger/api/missing", "", ""); response.Code != 404 || !strings.Contains(response.Header().Get("Content-Type"), "application/json") {
		t.Fatal("prefixed API fell back to HTML")
	}
	if response := send("GET", "/api/accounts", "", ""); response.Code != 404 {
		t.Fatal("application escaped its URL prefix")
	}
}
