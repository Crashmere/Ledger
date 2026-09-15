package ledger

import (
	"path/filepath"
	"testing"
)

func TestBackupIncludesWALAndRestoreNeverOverwrites(t *testing.T) {
	store := testStore(t)
	account := account(t, store, "备份示例", "normal", 10000)
	transaction(t, store, TransactionInput{Type: "expense", Amount: 1234, AccountID: account.ID, Date: "2026-09-15"})
	directory := t.TempDir()
	backup := filepath.Join(directory, "backup.sqlite")
	restored := filepath.Join(directory, "restored.sqlite")
	if err := store.Backup(testContext, backup); err != nil {
		t.Fatal(err)
	}
	// 原库继续写入，备份应保持创建瞬间的数据。
	transaction(t, store, TransactionInput{Type: "expense", Amount: 500, AccountID: account.ID, Date: "2026-09-15"})
	if err := Restore(testContext, backup, restored); err != nil {
		t.Fatal(err)
	}
	if err := Restore(testContext, backup, restored); err == nil {
		t.Fatal("restore overwrote destination")
	}
	copy, err := Open(restored, false)
	if err != nil {
		t.Fatal(err)
	}
	defer copy.Close()
	summary, err := copy.Summary(testContext, SummaryQuery{})
	if err != nil || summary.TotalCount != 1 || summary.Expense != 1234 {
		t.Fatalf("backup: %+v %v", summary, err)
	}
	accounts, err := copy.Accounts(testContext)
	if err != nil || accounts.TotalBalance != 8766 {
		t.Fatal("backup balance", accounts, err)
	}
	if err = store.Backup(testContext, backup); err == nil {
		t.Fatal("backup overwrote file")
	}
}
