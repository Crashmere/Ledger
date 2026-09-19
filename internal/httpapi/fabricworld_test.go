package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"ledger/internal/ledger"
)

func TestFabricWorldSync(t *testing.T) {
	ctx := context.Background()
	s, err := ledger.Open(filepath.Join(t.TempDir(), "ledger.sqlite"), true)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	a, err := s.SaveAccount(ctx, "", ledger.AccountInput{Name: "副业", Kind: "normal"})
	if err != nil {
		t.Fatal(err)
	}
	c, err := s.SaveCategory(ctx, "", ledger.CategoryInput{AccountID: a.ID, Name: "纺织"})
	if err != nil {
		t.Fatal(err)
	}
	title := "测试棉布"
	in := ledger.TransactionInput{Type: "expense", Amount: 12345, AccountID: a.ID, CategoryID: &c.ID, Date: "2026-09-19", Title: &title}
	txn, err := s.SaveTransaction(ctx, "", in)
	if err != nil || !txn.FabricWorldEligible {
		t.Fatal(txn, err)
	}
	calls := 0
	status := 200
	fw := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		var data map[string]string
		if r.Method != "POST" || r.URL.Path != "/api/integrations/ledger" || json.NewDecoder(r.Body).Decode(&data) != nil {
			t.Error("unexpected request")
		}
		if data["transactionId"] != txn.ID || data["name"] != title || data["price"] != "123.45" || data["purchaseDate"] != "2026-09-19" || len(data) != 4 {
			t.Error(data)
		}
		w.WriteHeader(status)
		if status == 200 {
			w.Write([]byte(`{"id":"abcdefabcdefabcdefabcdefabcdefab"}`))
		}
	}))
	defer fw.Close()
	h := New(s, nil, Options{FabricWorldURL: fw.URL})
	sync := func(id string, expected int) {
		t.Helper()
		r := httptest.NewRecorder()
		h.ServeHTTP(r, httptest.NewRequest("POST", "/api/transactions/"+id+"/fabricworld", nil))
		if r.Code != expected {
			t.Fatalf("status %d: %s", r.Code, r.Body.String())
		}
		if expected == 200 && !strings.Contains(r.Body.String(), "/fabricworld/fabrics/abcdefabcdefabcdefabcdefabcdefab/edit") {
			t.Fatal(r.Body.String())
		}
	}
	status = 503
	sync(txn.ID, 502)
	status = 200
	sync(txn.ID, 200)
	sync(txn.ID, 200)
	if calls != 3 {
		t.Fatal(calls)
	}
	batch, err := s.SaveBatch(ctx, ledger.BatchRequest{Rows: []ledger.BatchRow{
		{Line: 1, AmountInput: "12", Title: "布料", AccountID: a.ID, CategoryID: &c.ID, Date: in.Date},
		{Line: 2, AmountInput: "+12", Title: "退款", AccountID: a.ID, CategoryID: &c.ID, Date: in.Date},
	}})
	if err != nil || len(batch.FabricWorldTransactions) != 1 || batch.FabricWorldTransactions[0].ID == "" {
		t.Fatal(batch, err)
	}
	for _, typ := range []string{"income", "expense"} {
		in.Type = typ
		if typ == "expense" {
			in.CategoryID = nil
		}
		other, err := s.SaveTransaction(ctx, "", in)
		if err != nil || other.FabricWorldEligible {
			t.Fatal(other, err)
		}
		sync(other.ID, 400)
	}
	otherAccount, _ := s.SaveAccount(ctx, "", ledger.AccountInput{Name: "日常", Kind: "normal"})
	otherCategory, _ := s.SaveCategory(ctx, "", ledger.CategoryInput{AccountID: otherAccount.ID, Name: "纺织"})
	in.AccountID, in.CategoryID = otherAccount.ID, &otherCategory.ID
	other, err := s.SaveTransaction(ctx, "", in)
	if err != nil || other.FabricWorldEligible {
		t.Fatal(other, err)
	}
	sync(other.ID, 400)
	if err = s.DeleteTransaction(ctx, txn.ID); err != nil {
		t.Fatal(err)
	}
	sync(txn.ID, 404)
	if calls != 3 {
		t.Fatal("ineligible expense contacted FabricWorld")
	}
}
