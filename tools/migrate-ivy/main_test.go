package main

import (
	"encoding/json"
	"testing"
)

func TestSnapshotPreservesTimeAndDeletionWithoutSettings(t *testing.T) {
	source := map[string]any{"app": "ivy-wallet", "formatVersion": 1, "dbUserVersion": 3, "tables": map[string]any{
		"account":  []any{map[string]any{"id": "a", "name": "现金", "color": -1, "icon": nil, "initial_balance": 10000, "include_in_balance": 1, "order_num": 0.5, "created_at": 1789430400000, "updated_at": nil, "deleted_at": nil, "kind": nil, "period_start": nil, "period_end": nil, "archived_at": nil}},
		"category": []any{}, "tag": []any{}, "txn_tag": []any{}, "setting": []any{map[string]any{"key": "unused", "value": "not imported"}},
		"txn": []any{map[string]any{"id": "t", "type": "expense", "amount": 928, "account_id": "a", "to_account_id": nil, "category_id": nil, "time": 1789460000123, "title": "早餐", "note": nil, "created_at": 1789460000123, "updated_at": 1789460000234, "deleted_at": 1789460000345}},
	}}
	raw, _ := json.Marshal(source)
	_, rows, err := parseSnapshot(raw)
	if err != nil {
		t.Fatal(err)
	}
	if rows["account"][0]["kind"] != "normal" || rows["account"][0]["order_num"] != 0.5 || rows["txn"][0]["time"] != int64(1789460000123) || rows["txn"][0]["amount"] != int64(928) || rows["txn"][0]["is_delete"] != int64(1) {
		t.Fatal("mapping lost data")
	}
	if _, ok := rows["setting"]; ok {
		t.Fatal("settings imported")
	}
	tables := source["tables"].(map[string]any)
	tables["txn"].([]any)[0].(map[string]any)["amount"] = 1.5
	raw, _ = json.Marshal(source)
	if _, _, err = parseSnapshot(raw); err == nil {
		t.Fatal("fractional cents accepted")
	}
}
