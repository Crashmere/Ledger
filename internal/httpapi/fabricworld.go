package httpapi

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"time"

	"ledger/internal/ledger"
)

var fabricIDPattern = regexp.MustCompile(`^[a-f0-9]{32}$`)
var fabricWorldClient = &http.Client{Timeout: 12 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}

// Read the saved transaction on the server; the browser supplies only its ID.
func (s *Server) syncFabricWorld(w http.ResponseWriter, r *http.Request) {
	txn, err := s.store.Transaction(r.Context(), r.PathValue("id"))
	if err != nil {
		respondError(w, err)
		return
	}
	if !txn.FabricWorldEligible {
		respondError(w, &ledger.Error{Code: "VALIDATION", Message: "仅副业账户的纺织支出可以同步"})
		return
	}
	if s.fabricWorldURL == "" {
		respond(w, 503, map[string]any{"error": ledger.Error{Code: "FABRICWORLD", Message: "FabricWorld 同步尚未配置"}})
		return
	}
	name := ""
	if txn.Title != nil {
		name = *txn.Title
	}
	body, _ := json.Marshal(map[string]string{"transactionId": txn.ID, "name": name, "purchaseDate": txn.Date, "price": fmt.Sprintf("%d.%02d", txn.Amount/100, txn.Amount%100)})
	req, err := http.NewRequestWithContext(r.Context(), http.MethodPost, s.fabricWorldURL+"/api/integrations/ledger", bytes.NewReader(body))
	if err != nil {
		respondError(w, err)
		return
	}
	req.Header.Set("Content-Type", "application/json")
	response, err := fabricWorldClient.Do(req)
	if err != nil {
		fabricWorldFailure(w)
		return
	}
	defer response.Body.Close()
	if response.StatusCode >= 400 && response.StatusCode < 500 {
		var problem struct {
			Message string `json:"message"`
		}
		if json.NewDecoder(io.LimitReader(response.Body, 4096)).Decode(&problem) == nil && problem.Message != "" {
			respond(w, 502, map[string]any{"error": ledger.Error{Code: "FABRICWORLD", Message: problem.Message}})
			return
		}
	}
	var result struct {
		ID string `json:"id"`
	}
	if response.StatusCode != http.StatusOK || json.NewDecoder(io.LimitReader(response.Body, 256<<10)).Decode(&result) != nil || !fabricIDPattern.MatchString(result.ID) {
		fabricWorldFailure(w)
		return
	}
	respond(w, 200, map[string]string{"fabricId": result.ID, "editUrl": "/fabricworld/fabrics/" + result.ID + "/edit"})
}

func fabricWorldFailure(w http.ResponseWriter) {
	respond(w, 502, map[string]any{"error": ledger.Error{Code: "FABRICWORLD", Message: "暂未收到 FabricWorld 的添加确认，可以重试。已保存的交易不受影响。"}})
}
