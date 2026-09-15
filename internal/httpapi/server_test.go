package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
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
